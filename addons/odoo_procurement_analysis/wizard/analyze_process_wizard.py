from odoo import fields, models


class ProcurementAnalysisWizard(models.TransientModel):
    _name = "procurement.analysis.wizard"
    _description = "Run Procurement Analysis"

    process_id = fields.Many2one("procurement.process", required=True)

    def action_confirm(self):
        self.ensure_one()
        self.process_id.action_run_analysis()
        return {"type": "ir.actions.act_window_close"}

