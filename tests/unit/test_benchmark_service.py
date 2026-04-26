from decimal import Decimal

from procurement_core.benchmark.service import BenchmarkService


def test_parse_falabella_html_extracts_market_matches() -> None:
    html = """
    <div pod-layout="4_GRID" pod-highlight="false" data-testid="ssr-pod" class="grid-pod">
      <a href="" data-pod="catalyst-pod" data-key="144224633" class="pod-link">
        <div class="pod-details">
          <div><b class="pod-title title-rebrand">REPROGRAF</b></div>
          <b id="testId-pod-displaySubTitle-144224633" class="pod-subTitle subTitle-rebrand">Resma Papel Ecológico Carta X 500 Unidades</b>
          <span><b id="testId-pod-displaySellerText-144224633" class="pod-sellerText seller-text-rebrand">Por DISPAPELES S.A.S</b></span>
        </div>
        <div class="pod-summary">
          <div id="testId-pod-prices-144224633" class="prices">
            <ol class="pod-prices">
              <li data-internet-price="19.551" class="prices-0">
                <span>$ 19.551</span>
              </li>
            </ol>
          </div>
        </div>
      </a>
    </div></div>
    """
    service = BenchmarkService()

    matches = service._parse_falabella_html(
        description="resma papel carta 500 hojas",
        search_url="https://www.falabella.com.co/falabella-co/search?Ntt=resma+papel+carta+500+hojas",
        html=html,
    )

    assert len(matches) == 1
    assert matches[0]["source_name"] == "Falabella"
    assert matches[0]["original_price"] == Decimal("19551")
    assert matches[0]["currency"] == "COP"
    assert matches[0]["comparability"] in {
        "medium_equivalent",
        "strong_equivalent",
        "exact",
    }


def test_match_benchmarks_uses_seed_as_fallback(tmp_path) -> None:
    seed_path = tmp_path / "benchmark_seed.json"
    seed_path.write_text(
        '[{"description":"guantes de nitrilo talla m caja x 100","price_cop":32000,"source_name":"Demo","source_url":"https://demo.local/item"}]',
        encoding="utf-8",
    )
    service = BenchmarkService(seed_path=seed_path)

    matches = service.match_benchmarks("guantes de nitrilo talla M caja x 100")

    assert matches
    assert any(match["source_name"] == "Demo" for match in matches)


def test_normalize_price_for_target_unit_divides_boxed_presentations() -> None:
    service = BenchmarkService()

    normalized, meta = service._normalize_price_for_target_unit(
        Decimal("245000"),
        presentation="Caja Papel Resma Carta BLC Brilliant Laser Copy Blanco 70 g 500 Hojas Caja x 10",
        target_unit="Resma",
    )

    assert normalized == Decimal("24500.00")
    assert meta["normalized_from_package"] is True
    assert meta["package_multiplier"] == 10


def test_trim_upper_price_outliers_discards_minor_extreme_high_values() -> None:
    prices = [
        Decimal("19551"),
        Decimal("19835"),
        Decimal("20900"),
        Decimal("21900"),
        Decimal("29900"),
        Decimal("245000"),
    ]

    filtered, meta = BenchmarkService.trim_upper_price_outliers(prices)

    assert Decimal("245000") not in filtered
    assert meta["outlier_filter_applied"] is True
    assert meta["filtered_count"] == 5


def test_summarize_prices_uses_filtered_distribution_when_high_tail_is_minor() -> None:
    prices = [
        Decimal("19551"),
        Decimal("19835"),
        Decimal("20900"),
        Decimal("21900"),
        Decimal("29900"),
        Decimal("245000"),
    ]

    summary = BenchmarkService.summarize_prices(prices)

    assert summary["benchmark_median"] == Decimal("20900")
    assert summary["benchmark_p75"] == Decimal("21900")
