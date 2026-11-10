"""Valida el perfil JSON CAF y la identidad del inventario; solo biblioteca estándar."""
import argparse,json,math,pathlib,sys,unicodedata

def folded(value):
    return ''.join(char for char in unicodedata.normalize('NFKD',str(value).lower()) if not unicodedata.combining(char))

def uses_entity_quote_as_cost(source):
    name=folded(source.get('name',''))
    return any(term in name for term in ('expediente','entidad','pliego','presupuesto oficial')) and any(term in name for term in ('cotiz','promedio','estudio de mercado','precio estimado','techo'))

def validate(value,s,path='$'):
    supported={'$schema','title','description','type','additionalProperties','required','properties','const','items','minItems','maxItems','minLength','maxLength','minimum','exclusiveMinimum','enum'}
    if set(s)-supported:raise ValueError(f'{path}: esquema usa reglas no implementadas {set(s)-supported}')
    typ=s.get('type');types=[typ] if isinstance(typ,str) else typ
    def matches(t):
        return {'object':isinstance(value,dict),'array':isinstance(value,list),'string':isinstance(value,str),'number':isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value),'null':value is None,'boolean':isinstance(value,bool)}.get(t,False)
    if types and not any(matches(t) for t in types):raise ValueError(f'{path}: tipo inválido')
    if 'const' in s and (value!=s['const'] or isinstance(value,bool)):raise ValueError(f'{path}: constante inválida')
    if 'enum' in s and value not in s['enum']:raise ValueError(f'{path}: valor fuera de catálogo')
    if isinstance(value,dict):
        if not set(s.get('required',[]))<=set(value):raise ValueError(f'{path}: campos obligatorios faltantes')
        props=s.get('properties',{})
        if s.get('additionalProperties') is False and set(value)-set(props):raise ValueError(f'{path}: campos extra {set(value)-set(props)}')
        for k,v in value.items():
            if k in props:validate(v,props[k],f'{path}.{k}')
    if isinstance(value,list):
        if not s.get('minItems',0)<=len(value)<=s.get('maxItems',math.inf):raise ValueError(f'{path}: cantidad de elementos')
        for i,v in enumerate(value):
            if 'items' in s:validate(v,s['items'],f'{path}[{i}]')
    if isinstance(value,str) and not s.get('minLength',0)<=len(value)<=s.get('maxLength',math.inf):raise ValueError(f'{path}: longitud de texto inválida')
    if isinstance(value,(int,float)) and not isinstance(value,bool):
        if not math.isfinite(value) or value<s.get('minimum',-math.inf) or value<=s.get('exclusiveMinimum',-math.inf):raise ValueError(f'{path}: número inválido')

def check(payload,inventory=None,originals=None):
    schema=json.loads((pathlib.Path(__file__).resolve().parent.parent/'references/CAF-esquema-salida.json').read_text(encoding='utf-8-sig'))
    validate(payload,schema)
    items=payload['items']
    for index,item in enumerate(items,1):
        data=item['data_organization']
        row=data.get('original_row')
        if (data['original_capture']=='literal') != bool(row):
            raise ValueError(f'Fila {index}: captura original incoherente')
        columns=[c['id'] for c in row['columns']] if row else []
        if len(set(columns))!=len(columns):raise ValueError(f'Fila {index}: columnas duplicadas')
        if any(c not in columns for m in data['normalization'] for c in m['column_ids']):raise ValueError(f'Fila {index}: columna no existente')
        ids=[c['id'] for c in item.get('additional_costs',[]) if c.get('id')]
        if len(set(ids))!=len(ids):raise ValueError(f'Fila {index}: IDs de costos duplicados')
        parts=data['components']
        if len({c['id'] for c in parts})!=len(parts):raise ValueError(f'Fila {index}: componentes duplicados')
        costs=[c['additional_cost_id'] for c in parts if c.get('additional_cost_id')]
        if len(set(costs))!=len(costs):raise ValueError(f'Fila {index}: costo atribuido dos veces')
        for part in parts:
            cost=part.get('additional_cost_id')
            if cost and (part['relationship']!='separate' or not any(c.get('id')==cost for c in item.get('additional_costs',[]))):raise ValueError(f'Fila {index}: vínculo de costo inválido')
            if part.get('factory_bundle') and not part.get('included_parts'):raise ValueError(f'Fila {index}: piezas incluidas faltantes')
    if originals is not None:
        if len(originals)!=len(items):raise ValueError('Originales: número de filas diferente')
        for index,(expected,item) in enumerate(zip(originals,items),1):
            data=item['data_organization'];row=data.get('original_row')
            if expected.get('columns'):
                if data['original_capture']!='literal':raise ValueError(f'Fila {index}: tabla recuperable no capturada')
                actual=row['columns'];wanted=expected['columns']
                if len(actual)!=len(wanted):raise ValueError(f'Fila {index}: cobertura de columnas incompleta')
                for pos,(a,b) in enumerate(zip(actual,wanted),1):
                    if a['header']!=b['header']:raise ValueError(f'Fila {index}, columna {pos}: encabezado u orden alterado')
                    if 'value' in b and a['value']!=b['value']:raise ValueError(f'Fila {index}, columna {pos}: celda original alterada')
                    if 'header_path' in b and a.get('header_path',[])!=b['header_path']:raise ValueError(f'Fila {index}, columna {pos}: grupo alterado')
                for key in ('document','locator'):
                    if key in expected and expected[key]!=row.get(key):raise ValueError(f'Fila {index}: cambia {key} original')
    signals=[]
    for pos,item in enumerate(items,1):
        ceiling=item.get('ceiling_unit_price')
        prices=[source.get('unit_price') for source in item.get('price_sources',[])]
        has_price=any(isinstance(price,(int,float)) and price>0 for price in prices)
        status=item.get('cost_basis_status')
        if item.get('deliverable_type')=='service':
            sources=item.get('price_sources',[])
            if has_price: signals.append({'row':pos,'kind':'service_positive_price'})
            if status!='pending': signals.append({'row':pos,'kind':'service_status_not_pending'})
            if len(sources)!=1: signals.append({'row':pos,'kind':'service_placeholder_count'})
            if any(source.get('unit_price')!=0 or source.get('currency')!='COP' or source.get('url') for source in sources): signals.append({'row':pos,'kind':'service_placeholder_invalid'})
            text=' '.join([item.get('notes','')]+[source.get('notes','') for source in sources])
            if 'PENDIENTE_COSTO' not in text: signals.append({'row':pos,'kind':'service_pending_marker_missing'})
            if item.get('additional_costs'): signals.append({'row':pos,'kind':'service_fragmented_costs'})
        for cost in item.get('additional_costs',[]):
            if cost.get('category')=='service' and cost.get('amount') is not None: signals.append({'row':pos,'kind':'service_associated_amount'})
        if status and ((status=='pending' and has_price) or (status!='pending' and not has_price)):
            signals.append({'row':pos,'kind':'cost_status_price_conflict'})
        if any('alternativa por confirmar' in folded(excerpt.get('locator','')) for excerpt in item.get('technical_annex',[])):
            signals.append({'row':pos,'kind':'unassigned_annex_in_item'})
        for source in item.get('price_sources',[]):
            if uses_entity_quote_as_cost(source):
                signals.append({'row':pos,'kind':'entity_quote_as_cost','source':source.get('name','')})
            price=source.get('unit_price')
            if isinstance(price,(int,float)) and price>0 and price==ceiling and source.get('currency','COP')=='COP':
                signals.append({'row':pos,'kind':'cost_ceiling_overlap','source':source.get('name','')})
    if inventory is not None:
        if len(items)!=len(inventory):raise ValueError('Inventario: número de filas diferente')
        for pos,(source,item) in enumerate(zip(inventory,items),1):
            if 'procurement_lot' in source and source['procurement_lot']!=item.get('procurement_lot'):raise ValueError(f'Fila {pos}: cambia lote contractual')
            for key in ('item','quantity','unit'):
                if key not in source or source[key]!=item[key]:raise ValueError(f'Fila {pos}: cambia {key}')
            literal=item.get('source_original',{}).get('description') or item.get('description')
            if source.get('description')!=literal:raise ValueError(f'Fila {pos}: cambia descripción original')
            if not ('reference_unit' in source or 'ceiling_unit_price' in source):raise ValueError(f'Fila {pos}: falta techo rector')
            ceiling=source.get('reference_unit',source.get('ceiling_unit_price'))
            if item['ceiling_unit_price']!=ceiling:raise ValueError(f'Fila {pos}: cambia techo rector')
    return {'rows':len(items),'inventory_checked':inventory is not None,'originals_checked':originals is not None,'schema_valid':True,'signals':signals,'scope':'Estructura, identidad y señales heurísticas de procedencia; no prueba precio, IVA, cumplimiento ni vigencia.'}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('salida');ap.add_argument('--inventario');ap.add_argument('--originales');args=ap.parse_args()
    read=lambda path:json.loads(pathlib.Path(path).read_text(encoding='utf-8-sig'))
    try:result=check(read(args.salida),read(args.inventario) if args.inventario else None,read(args.originales) if args.originales else None)
    except (ValueError,KeyError,TypeError,OSError) as exc:print(f'ERROR: {exc}',file=sys.stderr);return 1
    print(json.dumps(result,ensure_ascii=False))
    return 2 if any(signal['kind'].startswith('service_') for signal in result['signals']) else 0
if __name__=='__main__':sys.exit(main())
