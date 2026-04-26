import base64
import os
import tempfile
from pathlib import Path

from odoo import _, api, fields, models
from odoo.exceptions import UserError

try:
    from procurement_core.extractors.engine import LocalExtractionEngine
    from procurement_core.models.enums import FileType
    from procurement_core.services.normalization import normalize_raw_item
    from procurement_core.storage.files import detect_file_type
except Exception as exc:  # pragma: no cover
    LocalExtractionEngine = None
    FileType = None
    normalize_raw_item = None
    detect_file_type = None
    IMPORT_ERROR = exc
else:
    IMPORT_ERROR = None


class ProcurementProcess(models.Model):
    _name = "procurement.process"
    _description = "Procurement Process"
    _inherit = ["mail.thread", "mail.activity.mixin"]

    name = fields.Char(required=True, tracking=True)
    external_reference = fields.Char()
    contracting_entity = fields.Char()
    source_url = fields.Char()
    description = fields.Text()
    state = fields.Selection(
        [
            ("draft", "Draft"),
            ("ingested", "Ingested"),
            ("analyzed", "Analyzed"),
            ("review", "Review"),
        ],
        default="draft",
        tracking=True,
    )
    document_ids = fields.One2many("procurement.process.document", "process_id", string="Documents")
    item_ids = fields.One2many("procurement.process.item", "process_id", string="Items")
    issue_ids = fields.One2many("procurement.process.issue", "process_id", string="Issues")
    item_count = fields.Integer(compute="_compute_counts")
    document_count = fields.Integer(compute="_compute_counts")
    issue_count = fields.Integer(compute="_compute_counts")

    @api.depends("document_ids", "item_ids", "issue_ids")
    def _compute_counts(self):
        for record in self:
            record.document_count = len(record.document_ids)
            record.item_count = len(record.item_ids)
            record.issue_count = len(record.issue_ids)

    def _ensure_core_available(self):
        if LocalExtractionEngine is None:
            raise UserError(_("procurement_core is not available in the Odoo Python environment: %s") % IMPORT_ERROR)

    def action_open_analysis_wizard(self):
        return {
            "type": "ir.actions.act_window",
            "res_model": "procurement.analysis.wizard",
            "view_mode": "form",
            "target": "new",
            "context": {"default_process_id": self.id},
        }

    def action_run_analysis(self):
        self.ensure_one()
        self._ensure_core_available()
        extraction_engine = LocalExtractionEngine()
        self.item_ids.unlink()
        self.issue_ids.unlink()

        for document in self.document_ids:
            attachment = document.attachment_id
            if not attachment or not attachment.datas:
                continue
            raw_bytes = base64.b64decode(attachment.datas)
            suffix = os.path.splitext(attachment.name or document.name or "")[1] or ".bin"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(raw_bytes)
                tmp_path = tmp.name
            try:
                file_type_value = document.file_type or detect_file_type(document.name).value
                proxy_document = type(
                    "DocumentProxy",
                    (),
                    {
                        "file_name": document.name,
                        "mime_type": None,
                        "file_type": FileType(file_type_value),
                        "storage_path": str(Path(tmp_path)),
                    },
                )()
                profile, batch = extraction_engine.extract_document(proxy_document)
                classification = (batch.metadata or {}).get("classification", {})
                document.document_kind = batch.document_kind.value
                document.file_type = file_type_value
                document.page_count = len(batch.pages)

                for candidate in batch.items:
                    item = self.env["procurement.process.item"].create(
                        {
                            "process_id": self.id,
                            "document_id": document.id,
                            "item_number": candidate.raw_item_number,
                            "raw_description": candidate.raw_description,
                            "raw_quantity": candidate.raw_quantity,
                            "raw_unit": candidate.raw_unit,
                            "raw_unit_price": candidate.raw_unit_price,
                            "raw_total": candidate.raw_total,
                            "lot": candidate.lot,
                            "origin_ref": candidate.sheet_name or (candidate.page_number and f"Page {candidate.page_number}") or "",
                            "extraction_method": f"{candidate.extraction_method.value}:{profile.route}",
                            "extraction_confidence": float(candidate.extraction_confidence or 0),
                        }
                    )
                    normalized = normalize_raw_item(
                        type(
                            "RawProxy",
                            (),
                            {
                                "raw_description": item.raw_description,
                                "raw_quantity": item.raw_quantity,
                                "raw_unit": item.raw_unit,
                                "raw_unit_price": item.raw_unit_price,
                                "raw_total": item.raw_total,
                                "raw_tax_note": None,
                                "lot": item.lot,
                                "evidence_json": {"item_number": item.item_number},
                            },
                        )()
                    )
                    item.write(
                        {
                            "normalized_description": normalized.get("normalized_description"),
                            "quantity_num": normalized.get("quantity_num"),
                            "unit_normalized": normalized.get("unit_normalized"),
                            "unit_price_cop": normalized.get("unit_price_cop"),
                            "total_cop": normalized.get("total_cop"),
                            "lot_normalized": normalized.get("lot_normalized"),
                            "canonical_item_key": normalized.get("canonical_item_key"),
                        }
                    )
                    if not normalized.get("unit_normalized"):
                        self.env["procurement.process.issue"].create(
                            {
                                "process_id": self.id,
                                "item_id": item.id,
                                "severity": "medium",
                                "title": "Unidad ambigua o vacia",
                                "message": "El item requiere revision de unidad.",
                            }
                        )
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
        self.state = "analyzed"

    def action_view_documents(self):
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": _("Documents"),
            "res_model": "procurement.process.document",
            "view_mode": "tree,form",
            "domain": [("process_id", "=", self.id)],
        }

    def action_view_items(self):
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": _("Items"),
            "res_model": "procurement.process.item",
            "view_mode": "tree,form",
            "domain": [("process_id", "=", self.id)],
        }

    def action_view_issues(self):
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "name": _("Issues"),
            "res_model": "procurement.process.issue",
            "view_mode": "tree,form",
            "domain": [("process_id", "=", self.id)],
        }


class ProcurementProcessDocument(models.Model):
    _name = "procurement.process.document"
    _description = "Procurement Process Document"

    name = fields.Char(required=True)
    process_id = fields.Many2one("procurement.process", required=True, ondelete="cascade")
    attachment_id = fields.Many2one("ir.attachment", string="Attachment")
    file_type = fields.Selection(
        [("pdf", "PDF"), ("word", "Word"), ("excel", "Excel"), ("image", "Image"), ("other", "Other")],
        default="other",
    )
    document_kind = fields.Char()
    page_count = fields.Integer()


class ProcurementProcessItem(models.Model):
    _name = "procurement.process.item"
    _description = "Procurement Process Item"

    process_id = fields.Many2one("procurement.process", required=True, ondelete="cascade")
    document_id = fields.Many2one("procurement.process.document", ondelete="set null")
    item_number = fields.Char()
    raw_description = fields.Text(required=True)
    raw_quantity = fields.Char()
    raw_unit = fields.Char()
    raw_unit_price = fields.Char()
    raw_total = fields.Char()
    lot = fields.Char()
    origin_ref = fields.Char()
    extraction_method = fields.Char()
    extraction_confidence = fields.Float()
    normalized_description = fields.Text()
    quantity_num = fields.Float()
    unit_normalized = fields.Char()
    unit_price_cop = fields.Float()
    total_cop = fields.Float()
    lot_normalized = fields.Char()
    canonical_item_key = fields.Char()


class ProcurementProcessIssue(models.Model):
    _name = "procurement.process.issue"
    _description = "Procurement Process Issue"

    process_id = fields.Many2one("procurement.process", required=True, ondelete="cascade")
    item_id = fields.Many2one("procurement.process.item", ondelete="cascade")
    severity = fields.Selection(
        [("low", "Low"), ("medium", "Medium"), ("high", "High"), ("critical", "Critical")],
        default="medium",
    )
    title = fields.Char(required=True)
    message = fields.Text(required=True)
