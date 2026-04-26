{
    "name": "Procurement Analysis",
    "version": "18.0.1.0.0",
    "summary": "Financial and technical analysis for Colombian procurement processes",
    "category": "Sales",
    "depends": ["base", "mail"],
    "data": [
        "security/security.xml",
        "security/ir.model.access.csv",
        "views/procurement_process_views.xml",
        "wizard/analyze_process_wizard_views.xml",
    ],
    "application": True,
    "installable": True,
    "license": "LGPL-3",
}

