# -*- coding: utf-8 -*-
import json
import hashlib
import logging
import unicodedata
import urllib.parse
import urllib.request

import requests
from .caf_workbook_selection import render_workbook, MAX_WORKBOOK_CHARS
from markupsafe import Markup, escape

from odoo import _, api, fields, models
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class _MarketStudyExtractionError(ValueError):
    pass


def _market_study_check_documents(documents):
    """Check the folder's readable inputs, without interpreting the study."""
    if not isinstance(documents, list) or not documents:
        raise _MarketStudyExtractionError("La carpeta no contiene documentos legibles.")
    seen = set()
    for document in documents:
        if (not isinstance(document, dict)
                or not isinstance(document.get("id"), str) or not document["id"].strip()
                or not isinstance(document.get("name"), str) or not document["name"].strip()
                or not isinstance(document.get("text"), str) or not document["text"].strip()):
            raise _MarketStudyExtractionError("El expediente contiene un documento sin identidad, nombre o texto legible.")
        if document["id"] in seen:
            raise _MarketStudyExtractionError("El expediente repite un archivo.")
        seen.add(document["id"])


def _market_study_pdf_page_is_blank(image_path):
    """Conservative blank scan check, only after empty OCR at 150 dpi.

    Allow sparse pale scanner noise, never infer blankness from empty OCR alone.
    Dark marks, appreciable pale ink or locally dense marks keep failing closed.
    """
    from PIL import Image, ImageFilter

    with Image.open(image_path) as source:
        gray = source.convert("L")
    area = gray.width * gray.height
    # A single long straight scanner streak cannot encode text. Ignore only a
    # three-pixel-wide vertical band for this test; never alter the source PDF.
    # Everything outside the band must still pass the conservative blank test.
    marks = gray.point(lambda value: 255 if value < 250 else 0)
    columns = [marks.crop((x, 0, x + 1, gray.height)).histogram()[255]
               for x in range(gray.width)]
    if columns and max(columns) >= gray.height * 0.5:
        column = columns.index(max(columns))
        left, right = max(0, column - 1), min(gray.width, column + 2)
        band_count = sum(columns[left:right])
        # Reject thick strokes, tables and multiple scan lines rather than
        # silently discarding information that OCR could not understand.
        if sum(columns) - band_count <= max(20, int(area * 0.00001)):
            gray.paste(255, (left, 0, right, gray.height))
    histogram = gray.histogram()
    if any(histogram[:140]):
        return False
    if sum(histogram[:200]) > max(4, int(area * 0.00001)):
        return False
    if sum(histogram[:225]) > int(area * 0.001):
        return False
    marks = gray.point(lambda value: 255 if value < 225 else 0)
    # An 11x11 neighbourhood distinguishes pale strokes from isolated scan dust.
    if marks.filter(ImageFilter.BoxBlur(5)).getextrema()[1] > 38:
        return False
    if sum(histogram[:250]) > int(area * 0.004):
        return False
    faint_marks = gray.point(lambda value: 255 if value < 250 else 0)
    return faint_marks.filter(ImageFilter.BoxBlur(5)).getextrema()[1] <= 90



def _market_study_extract_document(content, file_kind):
    import io
    import time
    deadline = time.monotonic() + 120
    parts = []

    def append(text):
        if text:
            parts.append(text)

    if file_kind == "xlsx":
        from openpyxl import load_workbook
        from openpyxl.utils import get_column_letter
        from itertools import zip_longest
        values = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        formulas = None
        try:
            formulas = load_workbook(io.BytesIO(content), read_only=True, data_only=False)
            sheets = []
            for sheet, formula_sheet in zip(values.worksheets, formulas.worksheets):
                sheet.reset_dimensions()
                formula_sheet.reset_dimensions()
                rows = []
                for index, (row, formula_row) in enumerate(zip_longest(
                        sheet.iter_rows(values_only=True),
                        formula_sheet.iter_rows(values_only=True), fillvalue=()), 1):
                    cells = []
                    for column, (value, formula) in enumerate(zip_longest(row, formula_row), 1):
                        expression = formula if isinstance(formula, str) and formula.startswith("=") else None
                        if expression:
                            value = "%s [fórmula: %s]" % ("" if value is None else value, expression)
                        if value is not None and value != "":
                            cells.append(("%s%d" % (get_column_letter(column), index), value, expression))
                    if cells:
                        rows.append((index, cells))
                sheets.append({"title":sheet.title,"state":sheet.sheet_state,"rows":rows})
            try:
                return render_workbook(sheets, [n.attr_text for n in formulas.defined_names.values()], cell_separator="=")[0]
            except ValueError as error:
                raise _MarketStudyExtractionError(str(error)) from error
        finally:
            values.close()
            if formulas is not None:
                formulas.close()
    elif file_kind == "pdf":
        from PyPDF2 import PdfReader
        import os
        import subprocess
        import tempfile
        has_readable_page = False
        pages = PdfReader(io.BytesIO(content)).pages
        if not pages:
            raise _MarketStudyExtractionError("El PDF no contiene páginas legibles.")
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = os.path.join(tmpdir, "document.pdf")
            for page_number, page in enumerate(pages, 1):
                try:
                    text = (page.extract_text() or "").strip()
                except Exception:
                    text = ""
                if not text:
                    if time.monotonic() >= deadline:
                        raise _MarketStudyExtractionError('El PDF requiere más tiempo de extracción; no se enviará parcialmente.')
                    if not os.path.exists(pdf_path):
                        with open(pdf_path, "wb") as source:
                            source.write(content)
                    prefix = os.path.join(tmpdir, "page")
                    subprocess.run(["pdftoppm", "-png", "-r", "150", "-f", str(page_number), "-l", str(page_number), "-singlefile", pdf_path, prefix], check=True, timeout=max(1, min(60, deadline - time.monotonic())), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    image = prefix + ".png"
                    ocr = os.path.join(tmpdir, "ocr")
                    try:
                        subprocess.run(["tesseract", image, ocr, "-l", "spa"], check=True, timeout=max(1, min(60, deadline - time.monotonic())), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        with open(ocr + ".txt", encoding="utf-8", errors="strict") as output:
                            text = output.read().strip()
                        blank_page = not text and _market_study_pdf_page_is_blank(image)
                    finally:
                        for temporary in (image, ocr + ".txt"):
                            if os.path.exists(temporary):
                                os.unlink(temporary)
                    if blank_page:
                        append("[Página %d vacía]" % page_number)
                        continue
                    if not text:
                        raise _MarketStudyExtractionError("No se pudo leer la página %d del PDF; revise el original antes de enviar." % page_number)
                has_readable_page = True
                append("[Página %d]\n%s" % (page_number, text))
        if not has_readable_page:
            raise _MarketStudyExtractionError("El PDF no contiene texto legible; sólo páginas vacías.")
    elif file_kind == "text":
        append(content.decode("utf-8", errors="strict"))
    elif file_kind == "docx":
        import zipfile
        import re
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            xml = archive.read("word/document.xml").decode("utf-8", errors="strict")
        append(re.sub(r"<[^>]+>", " ", re.sub(r"</w:p>", "\n", xml)))
    text = "\n\n".join(parts).strip()
    if not text:
        raise _MarketStudyExtractionError("El documento no contiene texto legible; no se enviará un expediente parcial.")
    return text


STATUS_SELECTION = [
    ("esperando_insumos", "Esperando insumos"),
    ("en_cola", "En cola"),
    ("leyendo", "Leyendo expediente"),
    ("investigando", "Investigando mercado"),
    ("validando", "Validando entrega"),
    ("publicando", "Publicando en Finanzas"),
    ("pendiente_publicacion", "Pendiente de publicar en Finanzas"),
    ("listo_para_revisar", "Listo para revisar"),
    ("requiere_preparacion", "Requiere preparación"),
    ("fallido", "Fallido"),
]

DEFAULT_FINANCIAL_OFFER_INTERNAL_BASE_URL = "http://caf-dev-app-financial-offer-web:3000"
DEFAULT_FINANCIAL_OFFER_BASE_URL = "http://127.0.0.1:18030"


def _market_study_global_settings(ai_data):
    settings = ai_data.get("settings") or {}
    if "manual_reference_total" not in settings:
        return {}
    return {"settings": {
        "manual_reference_total": settings["manual_reference_total"],
    }}


class ProjectProjectMarketStudy(models.Model):
    _inherit = "project.project"

    caf_financial_task_id = fields.Many2one(
        "project.task",
        string="Tarea Análisis de Costos",
        compute="_compute_caf_financial_ai_state",
    )
    caf_financial_ai_status = fields.Selection(
        STATUS_SELECTION,
        string="Estado Evaluación IA",
        compute="_compute_caf_financial_ai_state",
    )
    caf_financial_ai_status_label = fields.Char(
        string="Progreso Evaluación IA",
        compute="_compute_caf_financial_ai_state",
    )
    caf_financial_ai_calc_url = fields.Char(
        string="URL Simulación IA",
        compute="_compute_caf_financial_ai_state",
    )
    caf_financial_ai_items_count = fields.Integer(
        string="Ítems Analizados IA",
        compute="_compute_caf_financial_ai_state",
    )
    caf_financial_ai_error = fields.Text(
        string="Error Evaluación IA",
        compute="_compute_caf_financial_ai_state",
    )
    caf_financial_ai_chat_url = fields.Char(
        string="Chat Evaluación IA",
        compute="_compute_caf_financial_ai_state",
    )
    caf_financial_ai_progress = fields.Char(
        string="Último avance IA",
        compute="_compute_caf_financial_ai_state",
    )

    @api.depends(
        "task_ids.caf_dossier_status",
        "task_ids.caf_financial_calc_url",
        "task_ids.caf_financial_ai_chat_url",
        "task_ids.caf_financial_ai_job_id",
        "task_ids.caf_financial_ai_progress",
    )
    def _compute_caf_financial_ai_state(self):
        status_labels = dict(STATUS_SELECTION)
        for proj in self:
            task = proj.task_ids.filtered(
                lambda t: t.caf_work_block == "financial" and "costos" in (t.name or "").lower()
            )[:1]
            if not task:
                task = proj.task_ids.filtered(lambda t: t.caf_work_block == "financial")[:1]
            if task:
                proj.caf_financial_task_id = task.id
                proj.caf_financial_ai_status = task.caf_dossier_status
                proj.caf_financial_ai_status_label = status_labels.get(task.caf_dossier_status, task.caf_dossier_status)
                proj.caf_financial_ai_calc_url = task.caf_financial_calc_url
                proj.caf_financial_ai_items_count = task.caf_financial_items_count
                proj.caf_financial_ai_error = task.caf_dossier_error
                proj.caf_financial_ai_chat_url = task._market_study_chat_url() if task.caf_financial_ai_job_id else False
                proj.caf_financial_ai_progress = task.caf_financial_ai_progress
            else:
                proj.caf_financial_task_id = False
                proj.caf_financial_ai_status = False
                proj.caf_financial_ai_status_label = False
                proj.caf_financial_ai_calc_url = False
                proj.caf_financial_ai_items_count = 0
                proj.caf_financial_ai_error = False
                proj.caf_financial_ai_chat_url = False
                proj.caf_financial_ai_progress = False

    def action_open_financial_simulation(self):
        self.ensure_one()
        url = self.caf_financial_ai_calc_url
        if not url:
            raise UserError(_("No hay simulación financiera generada todavía."))
        return {
            "type": "ir.actions.act_url",
            "url": url,
            "target": "new",
        }

    def action_caf_trigger_financial_ai_eval(self):
        """Botón manual a nivel de proyecto para activar el ciclo de evaluación financiera IA."""
        self.ensure_one()
        self.check_access("write")
        # Buscar la macrotarea de costos o financiera
        task = self.task_ids.filtered(
            lambda t: t.caf_work_block == "financial" and "costos" in (t.name or "").lower()
        )[:1]
        if not task:
            task = self.task_ids.filtered(lambda t: t.caf_work_block == "financial")[:1]
        if not task:
            raise UserError(_(
                "No se encontró una macrotarea de Análisis de Costos / Financiera activa en este proyecto. "
                "Verifica que el plan de trabajo esté iniciado."
            ))
        return task.action_trigger_financial_ai_eval()

    def action_open_financial_ai_chat(self):
        self.ensure_one()
        if not self.caf_financial_task_id:
            raise UserError(_("No hay una evaluación financiera IA asociada."))
        return self.caf_financial_task_id.action_open_financial_ai_chat()


class ProjectTaskMarketStudy(models.Model):
    _inherit = "project.task"

    caf_dossier_folder_id = fields.Char(string="Carpeta Insumos Drive", copy=False)
    caf_dossier_status = fields.Selection(
        STATUS_SELECTION,
        default="esperando_insumos",
        string="Estado Estudio de Mercado",
        tracking=True,
        copy=False,
    )
    caf_dossier_revision = fields.Integer(string="Revisión Expediente", default=1, copy=False)
    caf_dossier_ready_date = fields.Datetime(string="Fecha Insumos Listos", copy=False)
    caf_financial_calc_id = fields.Char(string="Calculation ID Finanzas", copy=False, tracking=True)
    caf_financial_calc_url = fields.Char(string="URL Simulador", copy=False)
    caf_financial_calc_deleted_at = fields.Datetime(string="Cálculo financiero eliminado", copy=False, readonly=True)
    caf_financial_support_md = fields.Text(string="Soporte Estudio Mercado", copy=False)
    caf_financial_items_count = fields.Integer(string="Ítems Analizados", copy=False)
    caf_financial_pending_count = fields.Integer(string="Ítems Pendientes", copy=False)
    caf_dossier_error = fields.Text(string="Diagnóstico / Error", copy=False)
    caf_financial_ai_external_run_id = fields.Char(
        string="ID externo estudio IA", copy=False, index=True,
    )
    caf_financial_ai_job_id = fields.Char(string="Job CAF IA", copy=False, index=True)
    caf_financial_ai_job_status = fields.Char(string="Estado job CAF IA", copy=False)
    caf_financial_ai_conversation_id = fields.Char(string="Conversación CAF IA", copy=False)
    caf_financial_ai_chat_url = fields.Char(string="Chat CAF IA", copy=False)
    caf_financial_ai_progress = fields.Char(string="Último avance CAF IA", copy=False)
    caf_financial_ai_events_json = fields.Text(string="Eventos CAF IA", copy=False)
    caf_financial_ai_snapshot_json = fields.Text(string="Snapshot documental IA", copy=False)
    caf_financial_ai_snapshot_sha256 = fields.Char(string="Huella snapshot IA", copy=False)
    caf_financial_ai_request_json = fields.Text(string="Solicitud CAF IA", copy=False)
    caf_financial_ai_request_sha256 = fields.Char(string="Huella solicitud CAF IA", copy=False)
    caf_financial_ai_result_json = fields.Text(string="Resultado validado IA", copy=False)
    caf_financial_ai_submitted_at = fields.Datetime(string="Enviado a CAF IA", copy=False)
    caf_financial_ai_last_poll_at = fields.Datetime(string="Última consulta CAF IA", copy=False)
    caf_financial_ai_retry_count = fields.Integer(string="Reintentos CAF IA", copy=False)
    caf_financial_import_key = fields.Char(string="Clave importación Finanzas", copy=False, index=True)

    def _dossier_write(self, vals):
        return self.sudo().with_context(caf_allow_closed_work_edit=True).write(vals)

    def action_mark_dossier_ready(self):
        """Disparo humano: marca que los insumos están listos en Drive."""
        for task in self:
            task.check_access("write")
            task.project_id.check_access("write")
            folder_id = task.caf_dossier_folder_id
            folder_error = False
            if task.project_id:
                proj_folder = task.project_id.caf_drive_folder_id
                if proj_folder and (not folder_id or folder_id == proj_folder):
                    try:
                        reader = self.env["caf.drive.reader.service"]
                        q = f"'{proj_folder}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                        res_sub = reader._request('GET', 'https://www.googleapis.com/drive/v3/files', params={'q': q, 'fields': 'files(id, name, mimeType)'})
                        folder_id, folder_error = task._market_study_folder_choice(
                            res_sub.get("files", []),
                        )
                    except Exception as e:
                        _logger.warning("Error buscando subcarpeta de insumos via Drive API: %s", e)
                        folder_id = False
                        folder_error = _("No se pudo verificar la subcarpeta financiera en Drive.")

            if not folder_id:
                task._dossier_write({
                    "caf_dossier_status": "requiere_preparacion",
                    "caf_dossier_error": folder_error or _(
                        "Falta una subcarpeta financiera inequívoca en Google Drive."
                    ),
                })
                task.message_post(body=_("Requiere preparación: no se encontró carpeta Google Drive asociada."))
                continue

            old_revision = task.caf_dossier_revision or 1
            new_revision = old_revision
            if task.caf_dossier_status in {"listo_para_revisar", "fallido"}:
                new_revision += 1

            values = {
                "caf_dossier_folder_id": folder_id,
                "caf_dossier_status": "en_cola",
                "caf_dossier_revision": new_revision,
                "caf_dossier_ready_date": fields.Datetime.now(),
                "caf_dossier_error": False,
            }
            if new_revision != old_revision:
                values.update({
                    "caf_financial_ai_external_run_id": False,
                    "caf_financial_ai_job_id": False,
                    "caf_financial_ai_job_status": False,
                    "caf_financial_ai_conversation_id": False,
                    "caf_financial_ai_chat_url": False,
                    "caf_financial_ai_progress": False,
                    "caf_financial_ai_events_json": False,
                    "caf_financial_ai_snapshot_json": False,
                    "caf_financial_ai_snapshot_sha256": False,
                    "caf_financial_ai_request_json": False,
                    "caf_financial_ai_request_sha256": False,
                    "caf_financial_ai_result_json": False,
                    "caf_financial_ai_submitted_at": False,
                    "caf_financial_ai_last_poll_at": False,
                    "caf_financial_ai_retry_count": 0,
                    "caf_financial_import_key": False,
                    "caf_financial_calc_id": False,
                    "caf_financial_calc_url": False,
                    "caf_financial_calc_deleted_at": False,
                    "caf_financial_support_md": False,
                    "caf_financial_items_count": 0,
                    "caf_financial_pending_count": 0,
                })
            task._dossier_write(values)
            task.message_post(
                body=_(
                    "Insumos financieros marcados como listos (Revisión %s). "
                    "Carpeta Drive ID: %s. Listo para evaluación IA."
                ) % (new_revision, folder_id)
            )
        return True

    def action_trigger_financial_ai_eval(self):
        """Encola la evaluación; el cron QA la ejecuta y la recupera tras reinicios."""
        self.ensure_one()
        self.check_access("write")
        self.project_id.check_access("write")
        current_run_id = self._market_study_external_run_id()
        same_active_run = bool(
            self.caf_financial_ai_job_id
            and self.caf_financial_ai_external_run_id == current_run_id
            and self.caf_financial_ai_job_status in {"queued", "running", "completed"}
            and self.caf_dossier_status != "listo_para_revisar"
        )
        if not same_active_run:
            self.action_mark_dossier_ready()

        if self.caf_dossier_status == "requiere_preparacion":
            raise UserError(self.caf_dossier_error or _("La carpeta de insumos no está configurada."))

        cron = self.env.ref(
            "caf_external_apps.cron_caf_market_study_dossiers", raise_if_not_found=False,
        )
        if cron and cron.active:
            cron._trigger()

        return {
            "type": "ir.actions.client",
            "tag": "display_notification",
            "params": {
                "title": _("Evaluación Financiera IA en cola"),
                "message": _(
                    "La solicitud quedó guardada. CAF IA abrirá un chat y mostrará el avance "
                    "en la caja de herramientas."
                ),
                "type": "info",
                "sticky": False,
            },
        }

    def action_open_financial_ai_chat(self):
        self.ensure_one()
        self.check_access("read")
        self.project_id.check_access("read")
        if not self.caf_financial_ai_job_id:
            raise UserError(_("CAF IA todavía está preparando el seguimiento de esta solicitud."))
        return {
            "type": "ir.actions.act_url",
            "url": self._market_study_chat_url(),
            "target": "new",
        }

    def action_open_financial_simulation(self):
        self.ensure_one()
        url = self.caf_financial_calc_url
        if not url and self.caf_financial_calc_id:
            url = f"{self._market_study_financial_settings()['public_base_url']}/calculations/{self.caf_financial_calc_id}"
        if not url:
            raise UserError(_("No hay simulación financiera generada todavía."))
        return {
            "type": "ir.actions.act_url",
            "url": url,
            "target": "new",
        }

    def _prepare_and_submit_market_study(self):
        """Congela el expediente y crea el job persistente en CAF IA."""
        self.ensure_one()
        task = self
        _logger.info("Iniciando estudio de mercado autónomo para tarea %s (Revisión %s)", task.id, task.caf_dossier_revision)
        if task._market_study_drive_direct_enabled():
            folder_id = task.caf_dossier_folder_id
            if not folder_id:
                task._dossier_write({
                    "caf_dossier_status": "requiere_preparacion",
                    "caf_dossier_error": _("No hay una carpeta Drive de insumos confirmada."),
                })
                return False
            external_run_id = task._market_study_external_run_id()
            payload = task._market_study_submit_payload(external_run_id)
            request_json = json.dumps(
                payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            )
            request_sha256 = hashlib.sha256(request_json.encode("utf-8")).hexdigest()
            if task.caf_financial_ai_request_json:
                try:
                    saved_payload = json.loads(task.caf_financial_ai_request_json)
                    saved_is_current = (
                        hashlib.sha256(task.caf_financial_ai_request_json.encode("utf-8")).hexdigest()
                        == task.caf_financial_ai_request_sha256
                        and task._market_study_is_drive_direct_payload(saved_payload)
                    )
                except (TypeError, ValueError, json.JSONDecodeError):
                    saved_is_current = False
                if saved_is_current:
                    return task._submit_market_study_snapshot()
            task._dossier_write({
                "caf_financial_ai_external_run_id": external_run_id,
                "caf_financial_ai_snapshot_json": False,
                "caf_financial_ai_snapshot_sha256": False,
                "caf_financial_ai_request_json": request_json,
                "caf_financial_ai_request_sha256": request_sha256,
                "caf_financial_ai_progress": _("Alcance Drive confirmado; creando chat en CAF IA."),
                "caf_dossier_error": False,
            })
            self.env.cr.commit()
            return task._submit_market_study_snapshot()
        if task.caf_financial_ai_snapshot_json:
            try:
                snapshot_json = task.caf_financial_ai_snapshot_json
                expected_hash = hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()
                if expected_hash != task.caf_financial_ai_snapshot_sha256:
                    raise ValueError("snapshot hash mismatch")
                documents = json.loads(snapshot_json)
                if not isinstance(documents, list) or not documents:
                    raise ValueError("empty snapshot")
            except (TypeError, ValueError, json.JSONDecodeError):
                task._dossier_write({
                    "caf_dossier_status": "fallido",
                    "caf_dossier_error": _("El snapshot documental guardado no pasó su control de integridad."),
                })
                return False
            try:
                _market_study_check_documents(documents)
            except _MarketStudyExtractionError as error:
                task._dossier_write({"caf_dossier_status": "fallido", "caf_dossier_error": str(error)})
                return False
            return task._submit_market_study_snapshot(documents)

        # 1. LEYENDO
        task._dossier_write({"caf_dossier_status": "leyendo"})
        self.env.cr.commit()

        folder_id = task.caf_dossier_folder_id or (task.project_id and task.project_id.caf_drive_folder_id)
        if not folder_id:
            task._dossier_write({
                "caf_dossier_status": "requiere_preparacion",
                "caf_dossier_error": _("No hay carpeta Drive configurada."),
            })
            return False

        reader = self.env["caf.drive.reader.service"]
        try:
            drive_files = reader.list_folder_recursive(folder_id, max_files=None, max_depth=None)
        except Exception as e:
            msg = _("Error accediendo a Google Drive: %s") % str(e)
            task._dossier_write({"caf_dossier_status": "fallido", "caf_dossier_error": msg})
            task.message_post(body=msg)
            return False

        if not drive_files:
            task._dossier_write({
                "caf_dossier_status": "requiere_preparacion",
                "caf_dossier_error": _("La carpeta Drive no contiene documentos."),
            })
            return False

        extracted_documents = []
        extraction_errors = []
        try:
            for f in drive_files:
                f_name = f.get("name") or "documento"
                file_kind = task._market_study_file_kind(f_name, f.get("mimeType") or "")
                if not file_kind:
                    continue
                try:
                    content, _mime, _name = reader.download_file(f)
                    text = _market_study_extract_document(content, file_kind)
                except _MarketStudyExtractionError as error:
                    extraction_errors.append("%s: %s" % (f_name, error))
                    continue
                except Exception as error:
                    _logger.warning("No se pudo extraer texto de %s (%s)", f_name, type(error).__name__)
                    extraction_errors.append("No se pudo leer completo el documento %s; revise el archivo original. No se enviará parcialmente." % f_name)
                    continue
                extracted_documents.append({"id": str(f.get("id") or ""), "name": f_name, "text": text})
            if extraction_errors:
                raise _MarketStudyExtractionError("Se revisaron los documentos disponibles. " + " | ".join(extraction_errors))
            _market_study_check_documents(extracted_documents)
        except _MarketStudyExtractionError as error:
            task._dossier_write({"caf_dossier_status": "fallido", "caf_dossier_error": str(error)})
            return False

        if not extracted_documents:
            task._dossier_write({
                "caf_dossier_status": "requiere_preparacion",
                "caf_dossier_error": _("No se pudo extraer texto de los documentos en la carpeta Drive."),
            })
            return False

        snapshot_json = json.dumps(
            extracted_documents, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        )
        snapshot_sha256 = hashlib.sha256(snapshot_json.encode("utf-8")).hexdigest()

        external_run_id = task._market_study_external_run_id()
        request_json = json.dumps(
            task._market_study_submit_payload(external_run_id, extracted_documents),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        task._dossier_write({
            "caf_financial_ai_external_run_id": external_run_id,
            "caf_financial_ai_snapshot_json": snapshot_json,
            "caf_financial_ai_snapshot_sha256": snapshot_sha256,
            "caf_financial_ai_request_json": request_json,
            "caf_financial_ai_request_sha256": hashlib.sha256(
                request_json.encode("utf-8"),
            ).hexdigest(),
            "caf_financial_ai_progress": _("Expediente leído; creando chat en CAF IA."),
            "caf_dossier_error": False,
        })
        self.env.cr.commit()

        return task._submit_market_study_snapshot(extracted_documents)

    @staticmethod
    def _market_study_file_kind(file_name, mime_type):
        name = str(file_name or "").lower()
        mime = str(mime_type or "").lower()
        extension = name.rsplit(".", 1)[-1] if "." in name else ""
        if extension == "pdf" or "pdf" in mime:
            return "pdf"
        # XLSX también contiene la palabra `officedocument`; debe resolverse
        # antes que DOCX para no buscar word/document.xml dentro del libro.
        if extension == "xlsx" or "spreadsheet" in mime:
            return "xlsx"
        if (
            extension == "docx"
            or "wordprocessingml" in mime
            or mime == "application/vnd.google-apps.document"
        ):
            return "docx"
        if extension in {"txt", "csv"} or mime.startswith("text/"):
            return "text"
        return False

    def _submit_market_study_snapshot(self, documents=None):
        self.ensure_one()
        external_run_id = self.caf_financial_ai_external_run_id or self._market_study_external_run_id()
        if self.caf_financial_ai_request_json:
            request_json = self.caf_financial_ai_request_json
            try:
                request_ok = (
                    hashlib.sha256(request_json.encode("utf-8")).hexdigest()
                    == self.caf_financial_ai_request_sha256
                )
                payload = json.loads(request_json)
            except (TypeError, ValueError):
                request_ok = False
                payload = None
            if self._market_study_drive_direct_enabled():
                request_ok = request_ok and self._market_study_is_drive_direct_payload(payload)
            if not request_ok or not isinstance(payload, dict):
                self._dossier_write({
                    "caf_dossier_status": "fallido",
                    "caf_dossier_error": _("La solicitud CAF IA guardada no pasó su control de integridad."),
                })
                return False
        else:
            payload = self._market_study_submit_payload(external_run_id, documents)
            request_json = json.dumps(
                payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            )
            self._dossier_write({
                "caf_financial_ai_request_json": request_json,
                "caf_financial_ai_request_sha256": hashlib.sha256(
                    request_json.encode("utf-8"),
                ).hexdigest(),
            })
        try:
            response = self._study_api_request("POST", "/api/study-runs", payload, timeout=30)
        except Exception as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            self._dossier_write({
                "caf_dossier_status": "fallido" if status_code == 409 else "en_cola",
                "caf_dossier_error": _("No se pudo crear el estudio en CAF IA: %s") % str(exc),
                "caf_financial_ai_retry_count": self.caf_financial_ai_retry_count + 1,
            })
            return False

        job_id = str(response.get("id") or "").strip()
        conversation_id = str(response.get("conversationId") or "").strip()
        if not job_id or not conversation_id:
            self._dossier_write({
                "caf_dossier_status": "fallido",
                "caf_dossier_error": _("CAF IA aceptó la solicitud sin job o conversación."),
            })
            return False
        chat_url = self._market_study_chat_url(conversation_id)
        self._dossier_write({
            "caf_dossier_status": "investigando",
            "caf_financial_ai_job_id": job_id,
            "caf_financial_ai_job_status": response.get("status") or "queued",
            "caf_financial_ai_conversation_id": conversation_id,
            "caf_financial_ai_chat_url": chat_url,
            "caf_financial_ai_submitted_at": fields.Datetime.now(),
            "caf_financial_ai_progress": _("Chat creado; CAF IA está ejecutando el estudio."),
            "caf_dossier_error": False,
        })
        self.message_post(body=Markup(_(
            "CAF IA abrió el estudio en <a href='%(url)s' target='_blank'>este chat</a>."
        )) % {"url": escape(chat_url)})
        return True

    @staticmethod
    def _market_study_folder_choice(folders):
        def normalized(value):
            plain = unicodedata.normalize("NFKD", str(value or ""))
            return " ".join(
                "".join(char for char in plain if not unicodedata.combining(char))
                .lower().split()
            )

        candidates = [
            folder for folder in (folders or [])
            if any(key in normalized(folder.get("name")) for key in (
                "financier", "costo", "insumo",
            ))
        ]
        exact = [
            folder for folder in candidates
            if normalized(folder.get("name")) == "analisis financiero"
        ]
        if len(exact) == 1:
            return exact[0].get("id"), False
        if len(exact) > 1:
            return False, _("Hay varias subcarpetas llamadas Análisis financiero.")
        if len(candidates) == 1:
            return candidates[0].get("id"), False
        if len(candidates) > 1:
            return False, _("Hay varias subcarpetas financieras posibles; selecciónala en la tarea.")
        return False, _("No se encontró la subcarpeta Análisis financiero.")

    def _market_study_external_run_id(self):
        self.ensure_one()
        project_id = self.project_id.id if self.project_id else 0
        return "odoo:%s:project:%s:task:%s:revision:%s" % (
            self.env.cr.dbname, project_id, self.id, self.caf_dossier_revision or 1,
        )

    def _market_study_drive_direct_enabled(self):
        value = self.env["ir.config_parameter"].sudo().get_param(
            "caf_ai_service.drive_direct_enabled", "false",
        )
        return str(value or "").strip().lower() in {"1", "true", "yes", "on"}

    def _market_study_is_drive_direct_payload(self, payload):
        self.ensure_one()
        return bool(
            isinstance(payload, dict)
            and "documents" not in payload
            and payload.get("driveScope") == {"rootFolderId": self.caf_dossier_folder_id}
            and payload.get("externalRunId") == self._market_study_external_run_id()
            and payload.get("taskId") == self.id
            and payload.get("dossierRevision") == (self.caf_dossier_revision or 1)
            and isinstance(payload.get("project"), dict)
            and payload["project"].get("id") == self.project_id.id
        )

    def _market_study_submit_payload(self, external_run_id, documents=None):
        self.ensure_one()
        project = self.project_id
        if not project:
            raise UserError(_("La tarea financiera no pertenece a un proyecto."))
        base_url = self.env["ir.config_parameter"].sudo().get_param("web.base.url", "")
        project_url = "%s/web#id=%s&model=project.project&view_type=form" % (
            base_url.rstrip("/"), project.id,
        )
        payload = {
            "externalRunId": external_run_id,
            "project": {"id": project.id, "name": project.name, "url": project_url},
            "taskId": self.id,
            "dossierRevision": self.caf_dossier_revision or 1,
            "prompt": (
                "Ejecuta la skill caf-estudio-mercado sobre todos los documentos del expediente. "
                "Entrega resultado_finanzas.json válido para Finanzas y su soporte conforme a la skill."
            ),
        }
        if self._market_study_drive_direct_enabled():
            folder_id = self.caf_dossier_folder_id
            if not folder_id:
                raise UserError(_("No hay una carpeta Drive de insumos confirmada."))
            payload["driveScope"] = {"rootFolderId": folder_id}
        else:
            payload["documents"] = documents or []
        return payload

    def _market_study_service_settings(self):
        params = self.env["ir.config_parameter"].sudo()
        return {
            "base_url": (params.get_param(
                "caf_ai_service.base_url", "http://caf-ai-service:8080",
            ) or "").rstrip("/"),
            "chat_base_url": (params.get_param(
                "caf_ai_service.chat_base_url", "http://127.0.0.1:18840",
            ) or "").rstrip("/"),
            "token": params.get_param("caf_ai_service.token", "") or "",
        }

    def _market_study_financial_settings(self):
        params = self.env["ir.config_parameter"].sudo()
        public_base_url = (params.get_param(
            "caf_external_apps.financial_offer_base_url",
            DEFAULT_FINANCIAL_OFFER_BASE_URL,
        ) or "").strip().rstrip("/")
        internal_base_url = (params.get_param(
            "caf_external_apps.financial_offer_internal_base_url",
            public_base_url or DEFAULT_FINANCIAL_OFFER_INTERNAL_BASE_URL,
        ) or "").strip().rstrip("/")
        if public_base_url.startswith("/"):
            odoo_public_url = (params.get_param(
                "caf_external_apps.odoo_public_base_url",
                params.get_param("web.base.url", ""),
            ) or "").strip().rstrip("/")
            public_base_url = "%s%s" % (odoo_public_url, public_base_url)
        if not public_base_url or not internal_base_url:
            raise UserError(_("Falta configurar la URL pública o interna de Finanzas CAF."))
        return {
            "public_base_url": public_base_url,
            "import_url": "%s/api/import" % internal_base_url,
            "import_token": (params.get_param("caf_external_apps.financial_import_token", "") or "").strip(),
        }

    def _market_study_initial_dev_settings(self):
        """Keep initial financial studies on the explicitly bound DEV broker."""
        params = self.env["ir.config_parameter"].sudo()
        if params.get_param("caf_external_apps.financial_agent_odoo_db", "") != self.env.cr.dbname:
            raise UserError(_("El coordinador del estudio no pertenece a esta base de datos."))
        if params.get_param("caf_external_apps.financial_agent_tools_enabled", "False") != "True":
            raise UserError(_("El coordinador financiero DEV está deshabilitado."))
        base = (params.get_param("caf_external_apps.financial_agent_base_url", "") or "").strip().rstrip("/")
        if base != "http://caf-dev-finance-ai-coordinator:8080":
            raise UserError(_("El estudio inicial requiere el coordinador exclusivo de DEV."))
        token = (params.get_param("caf_external_apps.financial_agent_token", "") or "").strip()
        if not token:
            raise UserError(_("Falta configurar la credencial del coordinador financiero DEV."))
        return {"base_url": base, "token": token}

    def _study_api_request(self, method, path, payload=None, timeout=30):
        initial_study = path == "/api/study-runs" or path.startswith("/api/jobs/")
        settings = (
            self._market_study_initial_dev_settings()
            if initial_study else self._market_study_service_settings()
        )
        params = self.env["ir.config_parameter"].sudo()
        financial_base = (params.get_param("caf_external_apps.financial_agent_base_url", "") or "").rstrip("/")
        financial_enabled = params.get_param("caf_external_apps.financial_agent_tools_enabled", "False") == "True"
        if path == "/api/study-dialogue" and financial_base and financial_enabled:
            self.ensure_one()
            if params.get_param("caf_external_apps.financial_agent_odoo_db", "") != self.env.cr.dbname:
                raise UserError(_("La conexión financiera no pertenece a esta base de datos."))
            payload = dict(payload or {})
            expected_run = self._market_study_external_run_id()
            if (payload.get("jobId") != self.caf_financial_ai_job_id
                    or payload.get("externalRunId") != expected_run
                    or self.caf_financial_ai_external_run_id != expected_run
                    or payload.get("projectId") != self.project_id.id
                    or payload.get("taskId") != self.id
                    or payload.get("dossierRevision") != (self.caf_dossier_revision or 1)):
                raise UserError(_("La revisión financiera no coincide con esta tarea."))
            try:
                stored = json.loads(self.caf_financial_ai_result_json or "{}")
            except (TypeError, ValueError):
                stored = {}
            validated = self._validated_market_study_output({"output": stored})
            payload["initialContext"] = {
                "scope": {"calculationId": self.caf_financial_calc_id,
                          "odooDb": self.env.cr.dbname,
                          "externalRunId": expected_run, "taskId": self.id},
                "project": {"id": self.project_id.id, "name": self.project_id.name},
                "conversationId": self.caf_financial_ai_conversation_id,
                "output": validated,
            }
            settings = {"base_url": financial_base,
                        "token": params.get_param("caf_external_apps.financial_agent_token", "") or ""}
        if not settings["token"]:
            raise UserError(_("Falta configurar el token Odoo para CAF IA."))
        response = requests.request(
            method,
            settings["base_url"] + path,
            json=payload,
            headers={
                "Authorization": "Bearer %s" % settings["token"],
                "Content-Type": "application/json",
            },
            timeout=timeout,
            **({"allow_redirects": False} if initial_study else {}),
        )
        if not response.ok or (initial_study and 300 <= response.status_code < 400):
            detail = ""
            try:
                detail = str(response.json().get("error") or response.json().get("message") or "")
            except Exception:
                detail = (response.text or "")[:300]
            raise requests.HTTPError(
                "CAF IA HTTP %s: %s" % (response.status_code, detail), response=response,
            )
        return response.json()

    def _market_study_chat_url(self, conversation_id=None):
        self.ensure_one()
        return "/web/login?" + urllib.parse.urlencode({
            "db": self.env.cr.dbname,
            "redirect": "/caf/ia/tasks/%s/chat" % self.id,
        })

    @staticmethod
    def _market_study_progress(events, fallback):
        if not isinstance(events, list) or not events:
            return fallback
        last = events[-1]
        if isinstance(last, str):
            return last[:250]
        if isinstance(last, dict):
            for key in ("message", "title", "label", "status", "type"):
                if last.get(key):
                    return str(last[key])[:250]
        return fallback

    def _poll_market_study_job(self):
        self.ensure_one()
        if not self.caf_financial_ai_job_id:
            return self._prepare_and_submit_market_study()
        try:
            response = self._study_api_request(
                "GET", "/api/jobs/%s" % urllib.parse.quote(self.caf_financial_ai_job_id),
                timeout=30,
            )
        except Exception as exc:
            self._dossier_write({
                "caf_dossier_error": _("No se pudo consultar CAF IA: %s") % str(exc),
                "caf_financial_ai_retry_count": self.caf_financial_ai_retry_count + 1,
                "caf_financial_ai_last_poll_at": fields.Datetime.now(),
            })
            return False

        status = response.get("status")
        events = response.get("events") or []
        values = {
            "caf_financial_ai_job_status": status,
            "caf_financial_ai_last_poll_at": fields.Datetime.now(),
            "caf_financial_ai_events_json": json.dumps(events, ensure_ascii=False),
            "caf_financial_ai_progress": self._market_study_progress(
                events, _("CAF IA está ejecutando el estudio."),
            ),
            "caf_dossier_error": False,
        }
        conversation_id = response.get("conversationId") or self.caf_financial_ai_conversation_id
        if conversation_id:
            values.update({
                "caf_financial_ai_conversation_id": conversation_id,
                "caf_financial_ai_chat_url": self._market_study_chat_url(conversation_id),
            })
        if status in {"queued", "running"}:
            values["caf_dossier_status"] = "investigando"
            self._dossier_write(values)
            return True
        if status == "failed":
            values.update({
                "caf_dossier_status": "fallido",
                "caf_dossier_error": str(response.get("error") or _("CAF IA no pudo completar el estudio.")),
            })
            self._dossier_write(values)
            return False
        if status != "completed":
            values["caf_dossier_error"] = _("CAF IA devolvió un estado desconocido: %s") % status
            self._dossier_write(values)
            return False

        try:
            validated = self._validated_market_study_output(response)
        except Exception as exc:
            values.update({"caf_dossier_status": "fallido", "caf_dossier_error": str(exc)})
            self._dossier_write(values)
            return False
        publication_ready = self._financial_publication_enabled()
        values.update({
            "caf_dossier_status": "publicando" if publication_ready else "pendiente_publicacion",
            "caf_financial_ai_result_json": json.dumps(validated, ensure_ascii=False),
            "caf_financial_ai_progress": (
                _("Estudio validado; publicando el cálculo base.")
                if publication_ready
                else _("Estudio validado; la publicación espera autorización de QA.")
            ),
        })
        self._dossier_write(values)
        if not publication_ready:
            return True
        return self._publish_market_study_result(validated)

    def _validated_market_study_output(self, response):
        output = response.get("output") or response.get("result")
        if isinstance(output, str):
            output = json.loads(output)
        if not isinstance(output, dict):
            raise UserError(_("CAF IA completó el job sin una salida estructurada."))
        validation = output.get("validation") or {}
        if not isinstance(validation, dict) or validation.get("ok") is not True:
            raise UserError(_("La validación de CAF IA no aprobó el estudio."))
        ai_json = output.get("json")
        if isinstance(ai_json, str):
            ai_json = json.loads(ai_json)
        if not isinstance(ai_json, dict) or ai_json.get("version") not in (2, 3):
            raise UserError(_("CAF IA no devolvió JSON versión 2 o 3."))
        if not isinstance(ai_json.get("items"), list) or not ai_json["items"]:
            raise UserError(_("CAF IA no devolvió una lista válida de ítems."))
        return {
            "json": ai_json,
            "support": str(output.get("support") or ""),
            "validation": validation,
            "manifest": output.get("manifest") or [],
        }

    def _clear_deleted_financial_calculation(self, calc_id):
        self.ensure_one()
        if self.caf_financial_calc_id != calc_id:
            raise UserError(_("El expediente IA ya no está vinculado a este cálculo financiero."))
        self._dossier_write({
            "caf_financial_calc_id": False,
            "caf_financial_calc_url": False,
            "caf_financial_calc_deleted_at": fields.Datetime.now(),
            "caf_financial_ai_progress": _("El cálculo financiero asociado fue eliminado por una persona autorizada."),
        })

    def _market_study_project_context(self):
        """Datos del proyecto para que Finanzas muestre su nombre y el regreso, no solo el id."""
        self.ensure_one()
        project = self.project_id
        if not project:
            return {}
        base_url = (self.env["ir.config_parameter"].sudo().get_param("web.base.url", "") or "").rstrip("/")
        db_name = self.env.cr.dbname
        process_number = (
            getattr(project, "numero_proceso_licitatorio", False)
            or getattr(project, "lic_numero_proceso", False)
            or ""
        )
        entity_name = (
            getattr(project, "entidad_licitante", False)
            or getattr(project, "lic_entidad", False)
            or ""
        )
        return {
            "odoo_project_name": project.display_name,
            "odoo_process_number": process_number.strip() or None,
            "odoo_entity_name": entity_name.strip() or None,
            "odoo_return_url": (
                "%s/odoo/project.project/%s?db=%s" % (base_url, project.id, urllib.parse.quote(db_name))
                if base_url else None
            ),
            "odoo_db": db_name,
        }

    def _publish_market_study_result(self, validated=None):
        self.ensure_one()
        current_run = self._market_study_external_run_id()
        if self.caf_financial_calc_deleted_at and self.caf_financial_import_key == current_run:
            # Preserve the completed study; a deliberate deletion is not a signal
            # to recreate its calculation until a new dossier revision is opened.
            return False
        if self.caf_financial_calc_id and self.caf_financial_import_key == current_run:
            # Polling a completed delivery must not leave it publishing forever.
            self._dossier_write({
                "caf_dossier_status": "listo_para_revisar",
                "caf_financial_ai_progress": _("Estudio terminado y cálculo base publicado."),
                "caf_dossier_error": False,
            })
            return True
        if validated is None:
            try:
                validated = json.loads(self.caf_financial_ai_result_json or "{}")
            except ValueError:
                validated = {}
        try:
            validated = self._validated_market_study_output({"output": validated})
        except (UserError, ValueError, TypeError) as exc:
            self._dossier_write({
                "caf_dossier_status": "fallido",
                "caf_dossier_error": str(exc),
            })
            return False
        if not self._financial_publication_enabled():
            self._dossier_write({
                "caf_dossier_status": "pendiente_publicacion",
                "caf_financial_ai_progress": _(
                    "Estudio validado; la publicación espera autorización de QA."
                ),
            })
            return False
        ai_data = validated.get("json") or {}
        items = ai_data.get("items") or []
        if ai_data.get("version") not in (2, 3) or not items:
            self._dossier_write({
                "caf_dossier_status": "fallido",
                "caf_dossier_error": _("No hay resultado validado para publicar."),
            })
            return False

        external_key = self._market_study_external_run_id()
        project_name = self.project_id.name if self.project_id else self.name
        calc_name = "Estudio Mercado - %s - R%s" % (
            project_name[:35], self.caf_dossier_revision,
        )
        import_payload = {
            "version": ai_data.get("version"),
            "create_once": True,
            "source": {
                "system": "odoo_caf",
                "odoo_project_id": str(self.project_id.id if self.project_id else self.id),
                "run_id": external_key,
                "external_id": external_key,
                **self._market_study_project_context(),
            },
            "items": items,
            **_market_study_global_settings(ai_data),
        }
        financial_settings = self._market_study_financial_settings()
        if len(financial_settings["import_token"]) < 32:
            raise UserError(_("Falta configurar la credencial de importación de Finanzas CAF."))
        self._dossier_write({"caf_dossier_status": "publicando", "caf_financial_import_key": external_key})
        try:
            req = urllib.request.Request(
                financial_settings["import_url"],
                data=json.dumps(import_payload).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer %s" % financial_settings["import_token"],
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
            calc_id = resp_data.get("calculationId")
            if not calc_id:
                raise UserError(_("Finanzas respondió sin identificador de cálculo."))
        except Exception as exc:
            self._dossier_write({
                "caf_dossier_status": "pendiente_publicacion",
                "caf_dossier_error": _("Publicación pendiente en Finanzas CAF: %s") % str(exc),
                "caf_financial_ai_retry_count": self.caf_financial_ai_retry_count + 1,
            })
            return False

        calc_url_path = resp_data.get("url") or "/calculations/%s" % calc_id
        full_calc_url = (
            calc_url_path if str(calc_url_path).startswith(("http://", "https://"))
            else "%s%s" % (financial_settings["public_base_url"], calc_url_path)
        )
        if "caf.financial.offer" in self.env:
            offers = self.env["caf.financial.offer"].sudo()
            if not offers.search([("external_calc_id", "=", calc_id)], limit=1):
                offers.create({
                    "name": calc_name,
                    "project_id": self.project_id.id if self.project_id else False,
                    "simulation_origin": "ia",
                    "simulation_revision": self.caf_dossier_revision or 1,
                    "external_calc_id": calc_id,
                    "external_url": full_calc_url,
                    "status": "linked",
                    "source_title": project_name,
                })
        def source_pending(source, item):
            price = source.get("unit_price")
            if price is None or price == "":
                return True
            label = " ".join(str(value or "") for value in (
                source.get("name"), source.get("notes"), item.get("notes"),
            )).upper()
            if "PENDIENTE_COSTO" not in label or isinstance(price, bool):
                return False
            digits = [char for char in str(price) if char in "0123456789"]
            return bool(digits) and all(char == "0" for char in digits)

        pending_count = sum(
            1 for item in items
            if not item.get("price_sources")
            or any(source_pending(source, item) for source in item.get("price_sources") or [])
            or any(cost.get("amount") is None for cost in item.get("additional_costs") or [])
        )
        support_md = validated.get("support") or ""
        support_md += "\n\n- **Cálculo base en Finanzas:** [%s](%s)" % (calc_id, full_calc_url)
        self._dossier_write({
            "caf_dossier_status": "listo_para_revisar",
            "caf_financial_calc_id": calc_id,
            "caf_financial_calc_url": full_calc_url,
            "caf_financial_items_count": len(items),
            "caf_financial_pending_count": pending_count,
            "caf_financial_support_md": support_md,
            "caf_financial_ai_progress": _("Estudio terminado y cálculo base publicado."),
            "caf_dossier_error": False,
        })
        msg_body = Markup(_(
            "<b>Evaluación Financiera IA completada</b><br/>"
            "Cálculo base: <a href='%(url)s' target='_blank'>Abrir Simulador (%(calc)s)</a><br/>"
            "Ítems analizados: %(items)s (pendientes: %(pending)s)."
        )) % {
            "url": escape(full_calc_url),
            "calc": escape(calc_id),
            "items": len(items),
            "pending": pending_count,
        }
        self.message_post(body=msg_body)
        if self.project_id:
            self.project_id.message_post(body=msg_body)
        return True

    def _financial_publication_enabled(self):
        value = self.env["ir.config_parameter"].sudo().get_param(
            "caf_market_study.enable_financial_publication", "false",
        )
        return str(value or "").strip().lower() in {
            "1", "true", "yes", "on", "si", "sí", "verdadero",
        }

    @api.model
    def cron_process_market_study_dossiers(self, limit=3):
        tasks = self.search([
            ("caf_work_block", "=", "financial"),
            ("caf_dossier_status", "in", [
                "en_cola", "investigando", "validando", "publicando", "pendiente_publicacion",
            ]),
        ], order="caf_dossier_ready_date asc, id asc", limit=max(1, min(int(limit), 10)))
        processed = 0
        for task in tasks:
            try:
                if task.caf_dossier_status in {"publicando", "pendiente_publicacion"}:
                    task._publish_market_study_result()
                elif task.caf_financial_ai_job_id:
                    task._poll_market_study_job()
                else:
                    task._prepare_and_submit_market_study()
                processed += 1
            except Exception as exc:
                _logger.exception("Error procesando estudio persistente tarea %s", task.id)
                task._dossier_write({
                    "caf_dossier_error": str(exc),
                    "caf_financial_ai_retry_count": task.caf_financial_ai_retry_count + 1,
                })
        processed += self.env[
            "caf.market.study.revision.publication"
        ].sudo().cron_process_pending(limit=max(1, min(int(limit), 10)))
        return processed
