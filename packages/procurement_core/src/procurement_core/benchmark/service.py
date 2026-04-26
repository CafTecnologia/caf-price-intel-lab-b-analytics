from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from statistics import median
from urllib.parse import quote, quote_plus

import httpx
from rapidfuzz import fuzz

from procurement_core.config import get_settings
from procurement_core.llm.base import BaseLLMProvider, LLMResult
from procurement_core.models.enums import ProviderKind

_STOPWORDS = {
    "de",
    "del",
    "la",
    "el",
    "los",
    "las",
    "para",
    "por",
    "con",
    "sin",
    "y",
    "o",
    "unidad",
    "unidades",
    "item",
    "ítem",
    "kit",
    "tipo",
}

_OFFICE_KEYWORDS = {
    "papel",
    "resma",
    "folder",
    "carpeta",
    "cuaderno",
    "lapiz",
    "lápiz",
    "marcador",
    "esfero",
    "esferografo",
    "esferógrafo",
    "adhesivo",
    "contact",
    "hojas",
    "carta",
    "oficio",
    "archivador",
}
_SIZE_TOKENS = ["media carta", "oficio", "carta", "a4"]
_SEARCH_SOURCE_CATALOG: dict[str, dict[str, object]] = {
    "panamericana": {
        "label": "Panamericana",
        "strengths": ["papeleria", "oficina", "escolar", "archivo", "adhesivos"],
    },
    "homecenter": {
        "label": "Homecenter",
        "strengths": ["herramientas", "ferreteria", "jardineria", "seguridad", "contenedores", "medicion"],
    },
    "falabella": {
        "label": "Falabella",
        "strengths": ["retail_general", "hogar", "contenedores", "insumos generales"],
    },
    "walmart": {
        "label": "Walmart US",
        "strengths": ["retail_internacional", "laboratorio", "contenedores", "insumos generales"],
    },
}


@dataclass(slots=True)
class _CachedResponse:
    captured_at: datetime
    matches: list[dict]


class BenchmarkService:
    def __init__(self, seed_path: Path | None = None) -> None:
        self.seed_path = seed_path
        self.seed_data = self._load_seed(seed_path) if seed_path else []
        self._cache: dict[str, _CachedResponse] = {}
        self._fx_cache: dict[str, tuple[datetime, Decimal]] = {}

    def _load_seed(self, seed_path: Path) -> list[dict]:
        if not seed_path.exists():
            return []
        return json.loads(seed_path.read_text(encoding="utf-8"))

    def match_benchmarks(self, description: str, target_unit: str | None = None) -> list[dict]:
        matches, _ = self.match_benchmarks_with_trace(description, target_unit=target_unit)
        return matches

    def match_benchmarks_with_trace(
        self,
        description: str,
        target_unit: str | None = None,
        llm_provider: BaseLLMProvider | None = None,
        force_ai: bool = False,
        manual_instruction: str | None = None,
    ) -> tuple[list[dict], dict]:
        description = (description or "").strip()
        if not description:
            return [], {"used_llm": False, "sources_consulted": [], "queries_used": [], "source_results": {}}

        cache_key = f"{description}|{(target_unit or '').strip().lower()}"
        cached = self._cache.get(cache_key)
        if cached and not self._cache_expired(cached.captured_at):
            return cached.matches, {
                "used_llm": False,
                "from_cache": True,
                "sources_consulted": [],
                "queries_used": [],
                "source_results": {},
            }

        plan, planning_meta = self._build_search_plan(
            description,
            target_unit=target_unit,
            llm_provider=llm_provider,
            force_ai=force_ai,
            manual_instruction=manual_instruction,
        )
        matches: list[dict] = []
        source_results: dict[str, int] = {}
        for source_name in plan["sources"]:
            fetcher = self._source_fetcher(source_name)
            if fetcher is None:
                continue
            before_count = len(matches)
            for query in plan["queries"]:
                matches.extend(fetcher(description, target_unit=target_unit, query=query))
            source_results[source_name] = len(matches) - before_count
        if force_ai or self._should_escalate_search(matches):
            recovery_plan, recovery_meta = self._build_recovery_search_plan(
                description=description,
                target_unit=target_unit,
                current_matches=matches,
                current_plan=plan,
                llm_provider=llm_provider,
                manual_instruction=manual_instruction,
            )
            for source_name in recovery_plan["sources"]:
                fetcher = self._source_fetcher(source_name)
                if fetcher is None:
                    continue
                before_count = len(matches)
                for query in recovery_plan["queries"]:
                    matches.extend(fetcher(description, target_unit=target_unit, query=query))
                source_results[source_name] = source_results.get(source_name, 0) + (len(matches) - before_count)
            planning_meta["used_llm"] = planning_meta["used_llm"] or recovery_meta["used_llm"]
            if recovery_meta.get("llm_provider"):
                planning_meta["llm_provider"] = recovery_meta["llm_provider"]
            if recovery_meta.get("llm_model"):
                planning_meta["llm_model"] = recovery_meta["llm_model"]
            planning_meta["recovery_plan_payload"] = recovery_meta.get("llm_plan_payload")
            planning_meta["recovery_plan"] = recovery_plan

        matches.extend(self.match_seed_benchmarks(description, target_unit=target_unit))
        deduped = self._dedupe_matches(matches)
        self._cache[cache_key] = _CachedResponse(captured_at=datetime.now(UTC), matches=deduped)
        meta = {
            "used_llm": planning_meta["used_llm"],
            "llm_provider": planning_meta.get("llm_provider"),
            "llm_model": planning_meta.get("llm_model"),
            "product_family": plan.get("product_family"),
            "sources_consulted": plan["sources"],
            "queries_used": plan["queries"],
            "source_results": source_results,
            "plan_notes": plan.get("notes"),
            "search_exhausted": self._should_escalate_search(deduped),
            "force_ai": force_ai,
        }
        if planning_meta.get("llm_plan_payload"):
            meta["llm_plan_payload"] = planning_meta["llm_plan_payload"]
        if planning_meta.get("recovery_plan"):
            meta["recovery_plan"] = planning_meta["recovery_plan"]
        if planning_meta.get("recovery_plan_payload"):
            meta["recovery_plan_payload"] = planning_meta["recovery_plan_payload"]
        return deduped, meta

    def _cache_expired(self, captured_at: datetime) -> bool:
        ttl_seconds = max(get_settings().benchmark_cache_ttl_seconds, 60)
        return datetime.now(UTC) - captured_at > timedelta(seconds=ttl_seconds)

    def _source_fetcher(self, source_name: str):
        fetchers = {
            "panamericana": self._fetch_panamericana_matches,
            "homecenter": self._fetch_homecenter_matches,
            "falabella": self._fetch_falabella_matches,
            "walmart": self._fetch_walmart_matches,
        }
        return fetchers.get(source_name)

    def _fetch_falabella_matches(
        self,
        description: str,
        target_unit: str | None = None,
        query: str | None = None,
    ) -> list[dict]:
        query = (query or "").strip() or self._build_search_query(description)
        if not query:
            return []

        search_url = f"https://www.falabella.com.co/falabella-co/search?Ntt={quote_plus(query)}"
        try:
            response = httpx.get(
                "https://www.falabella.com.co/falabella-co/search",
                params={"Ntt": query},
                timeout=12.0,
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Accept-Language": "es-CO,es;q=0.9,en;q=0.7",
                },
            )
            response.raise_for_status()
        except httpx.HTTPError:
            return []

        return self._parse_falabella_html(description, search_url, response.text, target_unit=target_unit, query=query)

    def _fetch_panamericana_matches(
        self,
        description: str,
        target_unit: str | None = None,
        query: str | None = None,
    ) -> list[dict]:
        query = (query or "").strip() or self._build_panamericana_query(description)
        if not query:
            return []

        encoded_query = quote(query, safe="")
        api_url = f"https://www.panamericana.com.co/api/catalog_system/pub/products/search?ft={encoded_query}"
        search_url = f"https://www.panamericana.com.co/buscar?query={quote_plus(query)}"
        try:
            response = httpx.get(
                api_url,
                timeout=12.0,
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Accept": "application/json",
                    "Accept-Language": "es-CO,es;q=0.9,en;q=0.7",
                },
            )
            response.raise_for_status()
            payload = response.json()
        except Exception:
            return []

        matches: list[dict] = []
        for product in payload[:10]:
            title = str(product.get("productName") or product.get("productTitle") or "").strip()
            if not title:
                continue
            if self._has_size_conflict(description, title):
                continue

            items = product.get("items") or []
            best_seller = None
            best_price = None
            for item in items:
                sellers = (item.get("sellers") or [])[:3]
                for seller in sellers:
                    offer = (seller.get("commertialOffer") or {})
                    price = offer.get("Price")
                    if price in (None, 0, "0"):
                        continue
                    try:
                        numeric_price = Decimal(str(price))
                    except Exception:
                        continue
                    if best_price is None or numeric_price < best_price:
                        best_price = numeric_price
                        best_seller = seller.get("sellerName")

            if best_price is None:
                continue

            score = fuzz.token_set_ratio(description.lower(), title.lower()) / 100
            if score < 0.45:
                continue

            normalized_price, normalization_meta = self._normalize_price_for_target_unit(
                best_price,
                presentation=title,
                target_unit=target_unit,
            )
            comparability, comparability_score = self._comparability_from_score(score)
            matches.append(
                {
                    "source_name": "Panamericana",
                    "source_url": search_url,
                    "country": "CO",
                    "currency": "COP",
                    "original_price": best_price,
                    "normalized_price_cop": normalized_price,
                    "commercial_presentation": title,
                    "condition": "nuevo",
                    "comparability": comparability,
                    "comparability_score": comparability_score,
                    "observations": best_seller,
                    "evidence_json": {
                        "provider": "panamericana",
                        "query": description,
                        "search_query": query,
                        "search_url": search_url,
                        "matched_title": title,
                        "seller": best_seller,
                        "product_id": product.get("productId"),
                        "brand": product.get("brand"),
                        **normalization_meta,
                    },
                }
            )
        return matches[:6]

    def _fetch_homecenter_matches(
        self,
        description: str,
        target_unit: str | None = None,
        query: str | None = None,
    ) -> list[dict]:
        query = (query or "").strip() or self._build_search_query(description)
        if not query:
            return []

        search_url = f"https://www.homecenter.com.co/homecenter-co/search?Ntt={quote_plus(query)}"
        try:
            response = httpx.get(
                search_url,
                timeout=12.0,
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Accept-Language": "es-CO,es;q=0.9,en;q=0.7",
                },
            )
            response.raise_for_status()
        except httpx.HTTPError:
            return []

        script_match = re.search(
            r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
            response.text,
            flags=re.DOTALL,
        )
        if not script_match:
            return []

        try:
            payload = json.loads(script_match.group(1))
            results = payload["props"]["pageProps"]["searchProps"]["searchData"]["results"]
        except Exception:
            return []

        matches: list[dict] = []
        for product in results[:12]:
            title = str(product.get("displayName") or "").strip()
            brand = str(product.get("brand") or "").strip()
            if not title:
                continue
            if self._has_size_conflict(description, title):
                continue
            prices = product.get("prices") or []
            best_price = None
            for price_entry in prices:
                candidate = price_entry.get("priceWithoutFormatting") or price_entry.get("price")
                price = self._parse_price_to_decimal(str(candidate) if candidate is not None else None)
                if price is None or price <= 0:
                    continue
                if best_price is None or price < best_price:
                    best_price = price
            if best_price is None:
                continue

            score = fuzz.token_set_ratio(description.lower(), f"{brand} {title}".lower()) / 100
            if score < 0.42:
                continue

            normalized_price, normalization_meta = self._normalize_price_for_target_unit(
                best_price,
                presentation=title,
                target_unit=target_unit,
            )
            comparability, comparability_score = self._comparability_from_score(score)
            product_id = str(product.get("productId") or product.get("skuId") or "").strip()
            product_url = (
                f"https://www.homecenter.com.co/homecenter-co/product/{product_id}"
                if product_id
                else search_url
            )
            matches.append(
                {
                    "source_name": "Homecenter",
                    "source_url": product_url,
                    "country": "CO",
                    "currency": "COP",
                    "original_price": best_price,
                    "normalized_price_cop": normalized_price,
                    "commercial_presentation": title,
                    "condition": "nuevo",
                    "comparability": comparability,
                    "comparability_score": comparability_score,
                    "observations": brand or None,
                    "evidence_json": {
                        "provider": "homecenter",
                        "query": description,
                        "search_query": query,
                        "search_url": search_url,
                        "matched_title": title,
                        "brand": brand,
                        "product_id": product_id,
                        **normalization_meta,
                    },
                }
            )
        return matches[:6]

    def _fetch_walmart_matches(
        self,
        description: str,
        target_unit: str | None = None,
        query: str | None = None,
    ) -> list[dict]:
        query = (query or "").strip() or self._build_search_query(description)
        if not query:
            return []

        search_url = f"https://www.walmart.com/search?q={quote_plus(query)}"
        try:
            response = httpx.get(
                search_url,
                timeout=18.0,
                follow_redirects=True,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Accept-Language": "en-US,en;q=0.9,es;q=0.7",
                },
            )
            response.raise_for_status()
        except httpx.HTTPError:
            return []

        pattern = re.compile(
            r'"__typename":"Product".{0,3000}?"name":"(?P<name>[^"]+)".{0,9000}?"canonicalUrl":"(?P<url>[^"]+)".{0,2500}?"priceInfo":\{"itemPrice":"[^"]*","linePrice":"\$(?P<price>[0-9\.,]+)"',
            flags=re.DOTALL,
        )
        matches: list[dict] = []
        for product_match in pattern.finditer(response.text):
            raw_title = product_match.group("name")
            title = self._safe_unescape_text(raw_title)
            if not title:
                continue
            if self._has_size_conflict(description, title):
                continue
            price = self._parse_price_to_decimal(product_match.group("price"))
            if price is None or price <= 0:
                continue

            score = fuzz.token_set_ratio(description.lower(), title.lower()) / 100
            if score < 0.40:
                continue

            normalized_base_price, normalization_meta = self._normalize_price_for_target_unit(
                price,
                presentation=title,
                target_unit=target_unit,
            )
            converted_price, conversion_meta = self._convert_external_price_to_cop(
                normalized_base_price,
                currency="USD",
                country="US",
            )
            comparability, comparability_score = self._comparability_from_score(score)
            source_url = f"https://www.walmart.com{product_match.group('url')}"
            matches.append(
                {
                    "source_name": "Walmart US",
                    "source_url": source_url,
                    "country": "US",
                    "currency": "USD",
                    "original_price": price,
                    "normalized_price_cop": converted_price,
                    "commercial_presentation": title,
                    "condition": "nuevo",
                    "comparability": comparability,
                    "comparability_score": comparability_score,
                    "observations": "precio internacional con recargo de importación aplicado",
                    "evidence_json": {
                        "provider": "walmart",
                        "query": description,
                        "search_query": query,
                        "search_url": search_url,
                        "matched_title": title,
                        **normalization_meta,
                        **conversion_meta,
                    },
                }
            )
            if len(matches) >= 6:
                break
        return matches

    def _parse_falabella_html(
        self,
        description: str,
        search_url: str,
        html: str,
        target_unit: str | None = None,
        query: str | None = None,
    ) -> list[dict]:
        matches: list[dict] = []
        for block in re.findall(r'<div pod-layout="4_GRID".*?</a>\s*</div>', html, flags=re.DOTALL):
            subtitle = self._extract_regex(
                block,
                r'id="testId-pod-displaySubTitle-[^"]+"[^>]*>(.*?)</b>',
            )
            brand = self._extract_regex(
                block,
                r'pod-title title-rebrand">([^<]+)</b>',
            )
            seller = self._extract_regex(
                block,
                r'id="testId-pod-displaySellerText-[^"]+"[^>]*>(.*?)</b>',
            )
            price = self._extract_regex(block, r'data-internet-price="([^"]+)"')
            image_alt = self._extract_regex(block, r'<img [^>]*alt="([^"]+)"')

            title_parts = [part for part in [brand, subtitle] if part]
            title = " - ".join(title_parts) if title_parts else image_alt
            if not title or not price:
                continue
            if self._has_size_conflict(description, title):
                continue

            numeric_price = self._parse_price_to_decimal(price)
            if numeric_price is None or numeric_price <= 0:
                continue
            normalized_price, normalization_meta = self._normalize_price_for_target_unit(
                numeric_price,
                presentation=subtitle or title,
                target_unit=target_unit,
            )

            score = fuzz.token_set_ratio(description.lower(), title.lower()) / 100
            if score < 0.42:
                continue

            comparability, comparability_score = self._comparability_from_score(score)
            matches.append(
                {
                    "source_name": "Falabella",
                    "source_url": search_url,
                    "country": "CO",
                    "currency": "COP",
                    "original_price": numeric_price,
                    "normalized_price_cop": normalized_price,
                    "commercial_presentation": subtitle,
                    "condition": "nuevo",
                    "comparability": comparability,
                    "comparability_score": comparability_score,
                    "observations": seller,
                    "evidence_json": {
                        "provider": "falabella",
                        "query": description,
                        "search_query": query,
                        "search_url": search_url,
                        "matched_title": title,
                        "seller": seller,
                        **normalization_meta,
                    },
                }
            )

        return matches[:6]

    def match_seed_benchmarks(self, description: str, target_unit: str | None = None) -> list[dict]:
        matches: list[dict] = []
        for item in self.seed_data:
            score = fuzz.token_set_ratio(description.lower(), item["description"].lower()) / 100
            if score < 0.65:
                continue
            price = Decimal(str(item["price_cop"]))
            comparability, comparability_score = self._comparability_from_score(score)
            matches.append(
                {
                    "source_name": item["source_name"],
                    "source_url": item["source_url"],
                    "country": item.get("country", "CO"),
                    "currency": "COP",
                    "original_price": price,
                    "normalized_price_cop": self._normalize_price_for_target_unit(
                        price * Decimal(str(1 + get_settings().benchmark_import_factor)),
                        presentation=item.get("presentation") or item["description"],
                        target_unit=target_unit,
                    )[0],
                    "commercial_presentation": item.get("presentation"),
                    "condition": item.get("condition", "nuevo"),
                    "comparability": item.get("comparability", comparability),
                    "comparability_score": Decimal(str(round(score, 4))),
                    "observations": item.get("observations"),
                    "evidence_json": {"seed": True, "matched_description": item["description"]},
                }
            )
        return matches

    def _normalize_price_for_target_unit(
        self,
        price: Decimal,
        presentation: str | None,
        target_unit: str | None,
    ) -> tuple[Decimal, dict]:
        if not presentation or not target_unit:
            return price, {}

        target_unit_norm = target_unit.strip().lower()
        if not target_unit_norm:
            return price, {}

        presentation_norm = presentation.lower()
        if target_unit_norm in {"caja", "paquete", "kit", "bolsa", "rollo"}:
            return price, {}

        package_match = re.search(r"\b(caja|paquete|pack|bolsa|estuche|display)\s*x\s*(\d+)\b", presentation_norm)
        if not package_match:
            return price, {}

        package_kind = package_match.group(1)
        multiplier = int(package_match.group(2))
        if multiplier <= 1:
            return price, {}

        normalized = (price / Decimal(multiplier)).quantize(Decimal("0.01"))
        return normalized, {
            "normalized_from_package": True,
            "package_kind": package_kind,
            "package_multiplier": multiplier,
            "normalized_price_basis": f"price_divided_by_{multiplier}",
        }

    def _dedupe_matches(self, matches: list[dict]) -> list[dict]:
        deduped: list[dict] = []
        seen: set[tuple[str, str, str]] = set()
        for match in sorted(
            matches,
            key=lambda item: (
                str(item.get("source_name", "")),
                str(item.get("source_url", "")),
                -float(item.get("comparability_score") or 0),
            ),
        ):
            title = str((match.get("evidence_json") or {}).get("matched_title", "")).strip().lower()
            key = (
                str(match.get("source_name", "")).strip().lower(),
                str(match.get("source_url", "")).strip().lower(),
                title,
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(match)
        return deduped

    def _build_search_plan(
        self,
        description: str,
        target_unit: str | None = None,
        llm_provider: BaseLLMProvider | None = None,
        force_ai: bool = False,
        manual_instruction: str | None = None,
    ) -> tuple[dict[str, object], dict[str, object]]:
        heuristic_plan = self._build_heuristic_plan(description, target_unit=target_unit)
        if llm_provider is None or getattr(llm_provider, "provider_kind", ProviderKind.DISABLED) == ProviderKind.DISABLED:
            return heuristic_plan, {"used_llm": False}

        result = self._request_llm_search_plan(
            description=description,
            target_unit=target_unit,
            llm_provider=llm_provider,
            heuristic_plan=heuristic_plan,
            force_ai=force_ai,
            manual_instruction=manual_instruction,
        )
        if not result.succeeded or not result.payload:
            return heuristic_plan, {"used_llm": False, "error_message": result.error_message}

        plan = self._sanitize_llm_plan(result.payload, fallback=heuristic_plan)
        return plan, {
            "used_llm": True,
            "llm_provider": result.provider.value,
            "llm_model": result.model,
            "llm_plan_payload": result.payload,
        }

    def _build_heuristic_plan(self, description: str, target_unit: str | None = None) -> dict[str, object]:
        query = self._build_search_query(description)
        office_query = self._build_panamericana_query(description)
        description_lower = description.lower()
        product_family = "general"
        sources = ["falabella", "homecenter"]
        queries = [query]

        if any(keyword in description_lower for keyword in _OFFICE_KEYWORDS):
            product_family = "office"
            sources = ["panamericana", "falabella", "homecenter"]
            queries = [office_query, query]
        elif any(keyword in description_lower for keyword in {"azadon", "pala", "machete", "caneca", "fumigadora", "guantes", "proteccion"}):
            product_family = "hardware"
            sources = ["homecenter", "falabella"]
        elif any(keyword in description_lower for keyword in {"probeta", "termohigrometro", "reactiva", "ph"}):
            product_family = "lab"
            sources = ["homecenter", "falabella", "panamericana"]

        clean_queries = []
        for candidate in queries:
            candidate = (candidate or "").strip()
            if candidate and candidate not in clean_queries:
                clean_queries.append(candidate)
        return {
            "product_family": product_family,
            "sources": sources,
            "queries": clean_queries[:3],
            "notes": "Plan heurístico local usado como fallback o base del plan IA.",
        }

    def _build_recovery_search_plan(
        self,
        *,
        description: str,
        target_unit: str | None,
        current_matches: list[dict],
        current_plan: dict[str, object],
        llm_provider: BaseLLMProvider | None,
        manual_instruction: str | None,
    ) -> tuple[dict[str, object], dict[str, object]]:
        fallback = {
            "product_family": current_plan.get("product_family", "general"),
            "sources": ["homecenter", "falabella", "walmart"],
            "queries": [
                self._build_search_query(description),
                self._build_minimal_product_query(description),
            ],
            "notes": "Plan de recuperación local: amplía consulta a fuente internacional y query comercial mínima.",
        }
        fallback["queries"] = [query for query in fallback["queries"] if query][:4]
        if llm_provider is None or getattr(llm_provider, "provider_kind", ProviderKind.DISABLED) == ProviderKind.DISABLED:
            return fallback, {"used_llm": False}

        system_prompt = (
            "Eres un recuperador de benchmark para compras públicas. "
            "Ya hubo una búsqueda inicial insuficiente. "
            "Debes proponer una segunda ronda más agresiva pero controlada, con máximo 3 fuentes y máximo 3 queries. "
            "Puedes incluir Walmart US como fuente exterior. "
            "No inventes marcas ni referencias técnicas."
        )
        user_prompt = json.dumps(
            {
                "task": "benchmark_recovery_plan",
                "country_priority": ["CO", "US"],
                "description": description,
                "target_unit": target_unit,
                "current_plan": current_plan,
                "current_match_count": len(current_matches),
                "current_matches_preview": [
                    {
                        "source_name": match.get("source_name"),
                        "matched_title": (match.get("evidence_json") or {}).get("matched_title"),
                        "comparability": match.get("comparability"),
                    }
                    for match in current_matches[:5]
                ],
                "manual_instruction": manual_instruction,
                "allowed_sources": _SEARCH_SOURCE_CATALOG,
                "instructions": [
                    "No rendirte al primer intento, pero tampoco proponer búsqueda infinita.",
                    "Elegir máximo 3 queries y máximo 3 fuentes.",
                    "Si Colombia no fue suficiente, incluir Walmart US.",
                    "Simplificar la búsqueda a la naturaleza comercial del producto.",
                ],
                "expected_output": {
                    "product_family": "general",
                    "sources": ["homecenter", "falabella", "walmart"],
                    "queries": ["string", "string"],
                    "notes": "string",
                },
            },
            ensure_ascii=False,
        )
        result = llm_provider.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
        payload = self._parse_llm_json(result)
        if not result.succeeded or not payload:
            return fallback, {"used_llm": False, "error_message": result.error_message}
        plan = self._sanitize_llm_plan(payload, fallback=fallback)
        return plan, {
            "used_llm": True,
            "llm_provider": result.provider.value,
            "llm_model": result.model,
            "llm_plan_payload": payload,
        }

    def _request_llm_search_plan(
        self,
        *,
        description: str,
        target_unit: str | None,
        llm_provider: BaseLLMProvider,
        heuristic_plan: dict[str, object],
        force_ai: bool,
        manual_instruction: str | None,
    ) -> LLMResult:
        system_prompt = (
            "Eres un planificador de benchmark para contratación pública en Colombia. "
            "Tu tarea es decidir cómo buscar precios de mercado para un artículo usando solo fuentes colombianas permitidas. "
            "No inventes marcas, modelos ni equivalencias inexistentes. "
            "Debes elegir entre estas fuentes: panamericana, homecenter, falabella. "
            "Responde solo JSON válido."
        )
        user_prompt = json.dumps(
            {
                "task": "benchmark_search_plan",
                "country": "CO",
                "description": description,
                "target_unit": target_unit,
                "allowed_sources": _SEARCH_SOURCE_CATALOG,
                "heuristic_plan": heuristic_plan,
                "force_ai": force_ai,
                "manual_instruction": manual_instruction,
                "instructions": [
                    "Devuelve 2 a 3 queries cortas y útiles.",
                    "Elige 2 a 3 fuentes, no una sola salvo caso extremo.",
                    "Prioriza Homecenter para herramientas, jardinería, seguridad y contenedores.",
                    "Prioriza Panamericana para papelería y oficina.",
                    "Usa Falabella solo como fuente complementaria general, no como fuente única por defecto.",
                    "Si la descripción es muy técnica, simplifícala a la naturaleza comercial del producto sin inventar referencia específica.",
                ],
                "expected_output": {
                    "product_family": "office|hardware|lab|safety|container|general",
                    "sources": ["panamericana", "homecenter", "falabella"],
                    "queries": ["string", "string"],
                    "notes": "string",
                },
            },
            ensure_ascii=False,
        )
        result = llm_provider.complete_json(system_prompt=system_prompt, user_prompt=user_prompt)
        payload = self._parse_llm_json(result)
        result.payload = payload or result.payload
        return result

    def _sanitize_llm_plan(self, payload: dict, fallback: dict[str, object]) -> dict[str, object]:
        allowed_sources = set(_SEARCH_SOURCE_CATALOG.keys())
        sources = []
        for source in payload.get("sources", []):
            source_name = str(source).strip().lower()
            if source_name in allowed_sources and source_name not in sources:
                sources.append(source_name)
        if len(sources) < 2:
            for source in fallback["sources"]:
                if source not in sources:
                    sources.append(source)
                if len(sources) >= 2:
                    break

        queries = []
        for query in payload.get("queries", []):
            text = " ".join(re.findall(r"[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+", str(query)))
            text = re.sub(r"\s+", " ", text).strip()
            if text and text not in queries:
                queries.append(text)
        if not queries:
            queries = list(fallback["queries"])

        return {
            "product_family": str(payload.get("product_family") or fallback.get("product_family") or "general"),
            "sources": sources[:3],
            "queries": queries[:3],
            "notes": str(payload.get("notes") or fallback.get("notes") or ""),
        }

    def _build_minimal_product_query(self, description: str) -> str:
        tokens = re.findall(r"[a-zA-Z0-9]+", description.lower())
        filtered = [token for token in tokens if len(token) > 2 and token not in _STOPWORDS]
        return " ".join(filtered[:4])

    def _parse_llm_json(self, result: LLMResult) -> dict | None:
        if not result.content:
            return None
        content = result.content.strip()
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                try:
                    return json.loads(content[start : end + 1])
                except json.JSONDecodeError:
                    return None
        return None

    def _should_escalate_search(self, matches: list[dict]) -> bool:
        if len(matches) < 2:
            return True
        qualified = [
            match for match in matches
            if str(match.get("comparability")) in {"medium_equivalent", "strong_equivalent", "exact"}
        ]
        return len(qualified) < 2

    def _convert_external_price_to_cop(
        self,
        price: Decimal,
        *,
        currency: str,
        country: str,
    ) -> tuple[Decimal | None, dict[str, object]]:
        if currency.upper() == "COP":
            if country.upper() != "CO":
                import_factor = Decimal(str(1 + get_settings().benchmark_import_factor))
                return (price * import_factor).quantize(Decimal("0.01")), {
                    "fx_rate_to_cop": "1",
                    "import_factor_applied": str(get_settings().benchmark_import_factor),
                    "normalized_country": country,
                }
            return price, {"fx_rate_to_cop": "1", "normalized_country": country}

        fx_rate = self._get_fx_rate_to_cop(currency)
        if fx_rate is None:
            return None, {"fx_rate_missing": currency.upper()}

        converted = price * fx_rate
        if country.upper() != "CO":
            converted = converted * Decimal(str(1 + get_settings().benchmark_import_factor))
        return converted.quantize(Decimal("0.01")), {
            "fx_rate_to_cop": str(fx_rate),
            "import_factor_applied": str(get_settings().benchmark_import_factor if country.upper() != "CO" else 0),
            "normalized_country": country,
        }

    def _get_fx_rate_to_cop(self, currency: str) -> Decimal | None:
        currency = currency.upper().strip()
        if currency == "COP":
            return Decimal("1")
        cached = self._fx_cache.get(currency)
        if cached and not self._cache_expired(cached[0]):
            return cached[1]
        try:
            response = httpx.get(
                f"https://open.er-api.com/v6/latest/{currency}",
                timeout=12.0,
                follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            response.raise_for_status()
            payload = response.json()
            rate = Decimal(str(payload["rates"]["COP"]))
            self._fx_cache[currency] = (datetime.now(UTC), rate)
            return rate
        except Exception:
            if currency == "USD":
                return Decimal(str(get_settings().default_trm))
            return None

    def _build_search_query(self, description: str) -> str:
        tokens = re.findall(r"[a-zA-Z0-9]+", description.lower())
        filtered = [token for token in tokens if len(token) > 1 and token not in _STOPWORDS]
        if not filtered:
            return description[:120]
        return " ".join(filtered[:8])

    def _build_panamericana_query(self, description: str) -> str:
        tokens = re.findall(r"[a-zA-Z0-9]+", description.lower())
        filtered = [token for token in tokens if len(token) > 1 and token not in _STOPWORDS]
        if not filtered:
            return description[:60]
        priority_terms = []
        for preferred in ["resma", "papel", "carta", "oficio", "folder", "adhesivo", "cuaderno"]:
            if preferred in filtered and preferred not in priority_terms:
                priority_terms.append(preferred)
        for token in filtered:
            if token not in priority_terms:
                priority_terms.append(token)
        return " ".join(priority_terms[:4])

    def _has_size_conflict(self, description: str, title: str) -> bool:
        description_norm = description.lower()
        title_norm = title.lower()
        target_size = next((token for token in _SIZE_TOKENS if token in description_norm), None)
        source_size = next((token for token in _SIZE_TOKENS if token in title_norm), None)
        return bool(target_size and source_size and target_size != source_size)

    def _extract_regex(self, text: str, pattern: str) -> str | None:
        match = re.search(pattern, text, flags=re.DOTALL)
        if not match:
            return None
        value = re.sub(r"\s+", " ", match.group(1))
        return value.strip() or None

    def _safe_unescape_text(self, value: str | None) -> str:
        if not value:
            return ""
        normalized = value.replace("\\u002F", "/").replace("\\/", "/")
        try:
            return bytes(normalized, "utf-8").decode("unicode_escape", errors="ignore").strip()
        except Exception:
            return normalized.strip()

    def _parse_price_to_decimal(self, value: str) -> Decimal | None:
        cleaned = re.sub(r"[^\d,.\-]", "", value)
        if not cleaned:
            return None
        if cleaned.count(".") > 1 and "," not in cleaned:
            cleaned = cleaned.replace(".", "")
        elif cleaned.count(",") > 1 and "." not in cleaned:
            cleaned = cleaned.replace(",", "")
        elif "," in cleaned and "." in cleaned:
            if cleaned.rfind(",") > cleaned.rfind("."):
                cleaned = cleaned.replace(".", "").replace(",", ".")
            else:
                cleaned = cleaned.replace(",", "")
        elif "," in cleaned:
            parts = cleaned.split(",")
            if len(parts) == 2 and len(parts[1]) == 3:
                cleaned = "".join(parts)
            else:
                cleaned = cleaned.replace(",", ".")
        elif "." in cleaned:
            parts = cleaned.split(".")
            if len(parts) == 2 and len(parts[1]) == 3:
                cleaned = "".join(parts)
        try:
            return Decimal(cleaned)
        except Exception:
            return None

    def _comparability_from_score(self, score: float) -> tuple[str, Decimal]:
        if score >= 0.88:
            return ("exact", Decimal(str(round(score, 4))))
        if score >= 0.72:
            return ("strong_equivalent", Decimal(str(round(score, 4))))
        if score >= 0.56:
            return ("medium_equivalent", Decimal(str(round(score, 4))))
        return ("orientative", Decimal(str(round(score, 4))))

    @staticmethod
    def trim_upper_price_outliers(prices: list[Decimal]) -> tuple[list[Decimal], dict[str, object]]:
        if len(prices) < 4:
            return sorted(prices), {
                "original_count": len(prices),
                "filtered_count": len(prices),
                "discarded_high_outliers": [],
                "outlier_filter_applied": False,
            }

        filtered = sorted(prices)
        discarded: list[Decimal] = []
        thresholds: list[str] = []

        while len(filtered) >= 4:
            tail_price = filtered[-1]
            lower_cluster = filtered[:-1]
            lower_median = Decimal(str(median(lower_cluster)))
            lower_p75 = lower_cluster[min(len(lower_cluster) - 1, int((len(lower_cluster) - 1) * 0.75))]
            threshold = max(lower_median * Decimal("2.20"), lower_p75 * Decimal("1.80"))
            thresholds.append(str(threshold.quantize(Decimal("0.01"))))
            if tail_price > threshold and len(lower_cluster) > len(discarded):
                discarded.append(filtered.pop())
                continue
            break

        if discarded and len(discarded) < len(filtered):
            return filtered, {
                "original_count": len(prices),
                "filtered_count": len(filtered),
                "discarded_high_outliers": [str(value) for value in discarded],
                "outlier_filter_applied": True,
                "upper_thresholds_checked": thresholds,
            }

        return sorted(prices), {
            "original_count": len(prices),
            "filtered_count": len(prices),
            "discarded_high_outliers": [],
            "outlier_filter_applied": False,
            "upper_thresholds_checked": thresholds,
        }

    @staticmethod
    def summarize_prices(prices: list[Decimal]) -> dict[str, Decimal | None]:
        if not prices:
            return {
                "benchmark_min": None,
                "benchmark_median": None,
                "benchmark_p25": None,
                "benchmark_p75": None,
                "benchmark_dispersion": None,
            }
        ordered, outlier_meta = BenchmarkService.trim_upper_price_outliers(prices)
        return {
            "benchmark_min": ordered[0],
            "benchmark_median": Decimal(str(median(ordered))),
            "benchmark_p25": ordered[max(0, int((len(ordered) - 1) * 0.25))],
            "benchmark_p75": ordered[min(len(ordered) - 1, int((len(ordered) - 1) * 0.75))],
            "benchmark_dispersion": ordered[-1] - ordered[0] if len(ordered) > 1 else Decimal("0"),
            "benchmark_source_count_original": Decimal(str(outlier_meta["original_count"])),
            "benchmark_source_count_filtered": Decimal(str(outlier_meta["filtered_count"])),
        }
