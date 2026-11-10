# -*- coding: utf-8 -*-
import csv
import io
import json
import re
import zipfile

import requests
from requests.exceptions import RequestException

from odoo import _, models
from odoo.exceptions import UserError


DRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
DRIVE_FOLDER_MIMETYPE = 'application/vnd.google-apps.folder'
GOOGLE_EXPORTS = {
    'application/vnd.google-apps.document': ('text/plain', '.txt'),
    'application/vnd.google-apps.spreadsheet': ('text/csv', '.csv'),
    'application/vnd.google-apps.presentation': ('text/plain', '.txt'),
}


class CafDriveReaderService(models.AbstractModel):
    _name = 'caf.drive.reader.service'
    _description = 'CAF Servicio de lectura Google Drive'

    def _config(self):
        params = self.env['ir.config_parameter'].sudo()
        return {
            'client_id': (params.get_param('caf_drive.oauth_client_id') or '').strip(),
            'client_secret': (params.get_param('caf_drive.oauth_client_secret') or '').strip(),
            'refresh_token': (params.get_param('caf_drive.refresh_token') or '').strip(),
        }

    def _access_token(self):
        config = self._config()
        missing = [key for key, value in config.items() if not value]
        if missing:
            raise UserError(_(
                'Falta configurar Google Drive para el lector CAF: %s.'
            ) % ', '.join(missing))
        try:
            response = requests.post(
                DRIVE_TOKEN_URL,
                data={
                    'grant_type': 'refresh_token',
                    'client_id': config['client_id'],
                    'client_secret': config['client_secret'],
                    'refresh_token': config['refresh_token'],
                },
                timeout=30,
            )
        except RequestException as exc:
            raise UserError(_('No fue posible renovar el acceso a Drive: %s') % exc) from exc
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if not response.ok:
            detail = payload.get('error_description') or payload.get('error') or response.text[:300]
            raise UserError(_('Google Drive rechazo la autenticacion: %s') % detail)
        if not payload.get('access_token'):
            raise UserError(_('Google Drive no devolvio un token de acceso.'))
        return payload['access_token']

    def _request(self, method, url, *, token=None, params=None, payload=None, raw=False):
        token = token or self._access_token()
        headers = {'Authorization': 'Bearer %s' % token}
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        try:
            response = requests.request(
                method,
                url,
                params=params,
                json=payload,
                headers=headers,
                timeout=60,
            )
        except RequestException as exc:
            raise UserError(_('No fue posible comunicarse con Google Drive: %s') % exc) from exc
        if not response.ok:
            try:
                body = response.json()
            except ValueError:
                body = {}
            detail = body.get('error', {}).get('message') or response.text[:400]
            raise UserError(_('Google Drive devolvio un error: %s') % detail)
        if raw:
            return response.content
        try:
            return response.json()
        except ValueError:
            return {}

    def get_folder_metadata(self, folder_id):
        if not folder_id:
            raise UserError(_('El proyecto no tiene carpeta Drive asociada.'))
        return self._request(
            'GET',
            '%s/%s' % (DRIVE_FILES_URL, folder_id),
            params={'fields': 'id,name,mimeType,parents,webViewLink,trashed'},
        )

    def list_folder_recursive(self, folder_id, max_files=200, max_depth=6, token=None):
        if not folder_id:
            raise UserError(_('El proyecto no tiene carpeta Drive asociada.'))
        token = token or self._access_token()
        queue = [(folder_id, '', 0)]
        files = []
        seen_folders = set()
        while queue and (max_files is None or len(files) < max_files):
            current_id, current_path, depth = queue.pop(0)
            if current_id in seen_folders or (max_depth is not None and depth > max_depth):
                continue
            seen_folders.add(current_id)
            page_token = None
            while max_files is None or len(files) < max_files:
                params = {
                    'q': "'%s' in parents and trashed=false" % current_id,
                    'fields': 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,md5Checksum)',
                    'pageSize': 200 if max_files is None else min(200, max_files),
                    'supportsAllDrives': 'true',
                    'includeItemsFromAllDrives': 'true',
                }
                if page_token:
                    params['pageToken'] = page_token
                data = self._request('GET', DRIVE_FILES_URL, token=token, params=params)
                for item in data.get('files', []):
                    item = dict(item)
                    item['path'] = '%s/%s' % (current_path, item.get('name') or '') if current_path else (item.get('name') or '')
                    if item.get('mimeType') == DRIVE_FOLDER_MIMETYPE:
                        queue.append((item['id'], item['path'], depth + 1))
                    else:
                        files.append(item)
                        if max_files is not None and len(files) >= max_files:
                            break
                page_token = data.get('nextPageToken')
                if not page_token:
                    break
        return files


    def _list_folder_snapshot(self, folder_id, cursor=None, max_files=200,
                              max_pages=10, max_depth=6, token=None):
        """Bounded current inventory; continuation is internal, never historical proof.

        Keep the legacy list API unchanged. The project entry point authenticates
        continuation state before passing it here.
        """
        if not folder_id:
            raise UserError(_('El proyecto no tiene carpeta Drive asociada.'))
        max_files = max(1, min(1000, int(max_files)))
        max_pages = max(1, min(50, int(max_pages)))
        max_depth = max(0, min(100, int(max_depth)))
        state = cursor or {'queue': [[folder_id, '', 0, None]], 'seen': [],
                           'depthCuts': [], 'depthCutCount': 0, 'incompleteSearch': False}
        queue = [list(frame) for frame in state['queue']]
        seen = set(state['seen'])
        cuts = list(state['depthCuts'])
        cut_count = int(state.get('depthCutCount', len(cuts)))
        state_budget_exceeded = False
        incomplete = bool(state['incompleteSearch'])
        files, pages = [], 0
        token = token or self._access_token()
        if cursor is None:
            root = self._request('GET', '%s/%s' % (DRIVE_FILES_URL, folder_id),
                                 token=token, params={'fields': 'id,mimeType,trashed',
                                                      'supportsAllDrives': 'true'})
            if (root.get('id') != folder_id or root.get('trashed')
                    or root.get('mimeType') != DRIVE_FOLDER_MIMETYPE):
                raise UserError(_('La carpeta Drive no está disponible para inventario.'))
        while queue and len(files) < max_files and pages < max_pages:
            current_id, path, depth, page_token = queue.pop(0)
            if depth > max_depth:
                cut_count += 1
                if len(cuts) < 20:
                    cuts.append({'path': path[:1024], 'depth': depth})
                continue
            if page_token is None:
                if current_id in seen:
                    continue
                seen.add(current_id)
            params = {
                'q': "'%s' in parents and trashed=false" % current_id,
                'fields': 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,webViewLink,md5Checksum)',
                'pageSize': min(200, max_files - len(files)),
                'supportsAllDrives': 'true', 'includeItemsFromAllDrives': 'true',
            }
            if page_token:
                params['pageToken'] = page_token
            data = self._request('GET', DRIVE_FILES_URL, token=token, params=params)
            pages += 1
            incomplete = incomplete or bool(data.get('incompleteSearch'))
            for original in data.get('files', []):
                item = dict(original)
                item['path'] = '%s/%s' % (path, item.get('name') or '') if path else (item.get('name') or '')
                if item.get('mimeType') == DRIVE_FOLDER_MIMETYPE:
                    queue.append([item['id'], item['path'], depth + 1, None])
                else:
                    files.append(item)
            next_page = data.get('nextPageToken')
            if next_page:
                if next_page == page_token:
                    raise UserError(_('Drive repitió el cursor de paginación; inventario sin completar.'))
                queue.insert(0, [current_id, path, depth, next_page])
            # A stateless continuation must stay bounded even for folder-heavy
            # trees. Never emit an enormous signed cursor or hide this cut.
            checkpoint = {'queue': queue, 'seen': sorted(seen), 'depthCuts': cuts,
                          'depthCutCount': cut_count, 'incompleteSearch': incomplete}
            if len(json.dumps(checkpoint, separators=(',', ':')).encode()) > 24576:
                state_budget_exceeded = True
                break
        next_state = ({'queue': queue, 'seen': sorted(seen), 'depthCuts': cuts,
                       'depthCutCount': cut_count, 'incompleteSearch': incomplete}
                      if queue and not state_budget_exceeded else None)
        reasons = []
        if state_budget_exceeded:
            reasons.append('continuation_state_budget')
        elif queue:
            reasons.append('file_budget' if len(files) >= max_files else 'page_budget')
        if cut_count:
            reasons.append('depth_limit')
        if incomplete:
            reasons.append('provider_incomplete_search')
        return {
            'contract': 'caf-drive-inventory-snapshot/v1', 'files': files,
            'complete': not queue and not cut_count and not incomplete and not state_budget_exceeded,
            'nextCursor': next_state, 'limitations': reasons,
            'depthCuts': cuts, 'depthCutCount': cut_count, 'pagesRead': pages,
            'continuationStateBudgetBytes': 24576,
            'budgets': {'maxFiles': max_files, 'maxPages': max_pages, 'maxDepth': max_depth},
            'historicalCoverage': False, 'atomic': False,
            'coverageScope': 'files_accessible_to_connected_drive_account',
        }

    def download_file(self, file_info, token=None):
        file_id = file_info.get('id')
        mime_type = file_info.get('mimeType') or 'application/octet-stream'
        if mime_type in GOOGLE_EXPORTS:
            export_mime, extension = GOOGLE_EXPORTS[mime_type]
            content = self._request(
                'GET',
                '%s/%s/export' % (DRIVE_FILES_URL, file_id),
                token=token,
                params={'mimeType': export_mime},
                raw=True,
            )
            return content, export_mime, '%s%s' % (file_info.get('name') or 'documento', extension)
        content = self._request(
            'GET',
            '%s/%s' % (DRIVE_FILES_URL, file_id),
            token=token,
            params={'alt': 'media', 'supportsAllDrives': 'true'},
            raw=True,
        )
        return content, mime_type, file_info.get('name') or 'documento'

    @staticmethod
    def _clean_text(value):
        value = (value or '').replace('\x00', ' ')
        value = re.sub(r'[ \t]+', ' ', value)
        value = re.sub(r'\n{3,}', '\n\n', value)
        return value.strip()

    def extract_text(self, content, mime_type, filename):
        filename_lower = (filename or '').lower()
        try:
            if mime_type == 'application/pdf' or filename_lower.endswith('.pdf'):
                from PyPDF2 import PdfReader
                reader = PdfReader(io.BytesIO(content))
                text = '\n\n'.join((page.extract_text() or '') for page in reader.pages)
                return self._clean_text(text)
            if mime_type in ('text/plain', 'text/csv', 'application/json', 'application/xml') or filename_lower.endswith(('.txt', '.csv', '.json', '.xml')):
                return self._clean_text(content.decode('utf-8', errors='replace'))
            if filename_lower.endswith('.docx') or mime_type == 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                with zipfile.ZipFile(io.BytesIO(content)) as archive:
                    xml = archive.read('word/document.xml').decode('utf-8', errors='replace')
                xml = re.sub(r'</w:p>', '\n', xml)
                return self._clean_text(re.sub(r'<[^>]+>', ' ', xml))
            if filename_lower.endswith('.xlsx') or mime_type == 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
                from openpyxl import load_workbook
                workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
                rows = []
                for sheet in workbook.worksheets:
                    rows.append('[%s]' % sheet.title)
                    for row in sheet.iter_rows(values_only=True):
                        values = [str(value) for value in row if value not in (None, '')]
                        if values:
                            rows.append(' | '.join(values))
                return self._clean_text('\n'.join(rows))
        except Exception as exc:
            raise UserError(_('No se pudo extraer texto de %s: %s') % (filename, exc)) from exc
        return ''

    def download_and_extract(self, file_info, max_bytes=20 * 1024 * 1024, token=None):
        size = int(file_info.get('size') or 0)
        if size and size > max_bytes:
            return {
                'status': 'skipped',
                'text': '',
                'error': _('El archivo supera el limite de %s MB.') % round(max_bytes / 1024 / 1024),
            }
        try:
            content, mime_type, filename = self.download_file(file_info, token=token)
            if len(content) > max_bytes:
                return {'status': 'skipped', 'text': '', 'error': _('El archivo descargado supera el limite permitido.')}
            text = self.extract_text(content, mime_type, filename)
            if not text:
                return {'status': 'unsupported', 'text': '', 'error': _('Formato sin texto extraible en este MVP.')}
            return {'status': 'ready', 'text': text, 'error': ''}
        except UserError as exc:
            return {'status': 'error', 'text': '', 'error': str(exc)}
