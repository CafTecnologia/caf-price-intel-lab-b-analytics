from procurement_core.services.item_identity import build_canonical_item_key


def test_canonical_item_key_prefers_item_number_and_lot() -> None:
    key = build_canonical_item_key(
        raw_description="Resma de papel alcalino 500 hojas",
        raw_item_number="12",
        lot="Lote 3",
    )
    assert key == "item:12|lot:3"


def test_canonical_item_key_falls_back_to_description_when_item_absent() -> None:
    key = build_canonical_item_key(
        raw_description="Guante de nitrilo talla M",
        raw_item_number=None,
        lot=None,
    )
    assert key == "desc:guante de nitrilo talla m"
