from decimal import Decimal
from types import SimpleNamespace

from procurement_core.services.normalization import normalize_raw_item, normalize_unit, parse_decimal


def test_parse_decimal_handles_colombian_format() -> None:
    assert parse_decimal("1.234,56") == Decimal("1234.56")
    assert parse_decimal("$ 32.000") == Decimal("32000")
    assert parse_decimal("1.000.000") == Decimal("1000000")
    assert parse_decimal("1,000,000") == Decimal("1000000")
    assert parse_decimal("1,234,567.89") == Decimal("1234567.89")
    assert parse_decimal("1.234.567,89") == Decimal("1234567.89")


def test_normalize_unit_maps_common_aliases() -> None:
    assert normalize_unit("und") == "unidad"
    assert normalize_unit("kg") == "kilogramo"


def test_normalize_raw_item_derives_total_from_quantity_and_unit_price() -> None:
    raw_item = SimpleNamespace(
        raw_description="CANDADO MEDIANO",
        raw_quantity="12",
        raw_unit="Unidad",
        raw_unit_price="840000",
        raw_total=None,
        raw_tax_note=None,
        lot=None,
        evidence_json={"item_number": "1"},
    )

    normalized = normalize_raw_item(raw_item)

    assert normalized["quantity_num"] == Decimal("12")
    assert normalized["unit_price_cop"] == Decimal("840000")
    assert normalized["total_cop"] == Decimal("10080000")
    assert normalized["metadata_json"]["derived_total_from_unit_price"] is True


def test_normalize_raw_item_derives_unit_price_from_total() -> None:
    raw_item = SimpleNamespace(
        raw_description="CANDADO MEDIANO",
        raw_quantity="12",
        raw_unit="Unidad",
        raw_unit_price=None,
        raw_total="840000",
        raw_tax_note=None,
        lot=None,
        evidence_json={"item_number": "1", "financial_basis_role": "total"},
    )

    normalized = normalize_raw_item(raw_item)

    assert normalized["quantity_num"] == Decimal("12")
    assert normalized["unit_price_cop"] == Decimal("70000")
    assert normalized["total_cop"] == Decimal("840000")
    assert normalized["metadata_json"]["derived_unit_price_from_total"] is True
    assert normalized["metadata_json"]["financial_basis_role"] == "total"
