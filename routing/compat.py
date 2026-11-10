"""Small wire adapters. They never execute the caller's tools."""
import copy,json,time,uuid

def chat_request(body):
    messages=body.get('messages')
    if not isinstance(messages,list):raise ValueError('messages must be a list')
    items=[]
    for message in messages:
        role=message.get('role')
        if role=='tool':
            items.append(dict(type='function_call_output',call_id=message['tool_call_id'],output=message.get('content') or ''))
            continue
        content=message.get('content') or ''
        if isinstance(content,list):
            converted=[]
            for part in content:
                if part.get('type')=='image_url':
                    converted.append(dict(type='input_image',image_url=part['image_url']['url'],detail=part['image_url'].get('detail','auto')))
                elif part.get('type')=='text':
                    converted.append(dict(type='output_text' if role=='assistant' else 'input_text',text=part['text']))
                else:raise ValueError('Unsupported chat content')
            content=converted
        if content:items.append(dict(role=role,content=content))
        for call in message.get('tool_calls') or []:
            items.append(dict(type='function_call',call_id=call['id'],name=call['function']['name'],arguments=call['function']['arguments']))
    result=dict(input=items,max_output_tokens=body.get('max_completion_tokens',body.get('max_tokens',4096)))
    if body.get('response_format'):result['text']={'format':body['response_format']}
    if body.get('tools'):
        result['tools']=[dict(type='function',**tool['function']) for tool in body['tools'] if tool.get('type')=='function']
        if len(result['tools'])!=len(body['tools']):raise ValueError('Unsupported chat tool')
    if 'tool_choice' in body:
        choice=body['tool_choice']
        result['tool_choice']={'type':'function','name':choice['function']['name']} if isinstance(choice,dict) else choice
    return result

def chat_response(body):
    text=''.join(part.get('text','') for item in body['output'] if item.get('type')=='message'
        for part in item.get('content',[]) if part.get('type')=='output_text')
    calls=[dict(id=item['call_id'],type='function',function={'name':item['name'],'arguments':item['arguments']})
        for item in body['output'] if item.get('type')=='function_call']
    message=dict(role='assistant',content=text or None)
    if calls:message['tool_calls']=calls
    usage=body.get('usage')
    return dict(id=body['id'],object='chat.completion',created=body.get('created_at',int(time.time())),
        model=body['model'],choices=[dict(index=0,message=message,finish_reason='tool_calls' if calls else 'stop')],
        usage=dict(prompt_tokens=usage['input_tokens'],completion_tokens=usage['output_tokens'],
            total_tokens=usage['input_tokens']+usage['output_tokens']) if usage else None,
        caf_routing=body.get('caf_routing'))

def response_events(body):
    """Buffered SSE: preserve the response and usage once, no second model call."""
    # Native providers may omit the redundant total. Preserve unknown usage and
    # cache/detail counters; never invent zeros or mutate the ledger response.
    body=copy.deepcopy(body)
    usage=body.get('usage')
    if isinstance(usage,dict) and 'total_tokens' not in usage:
        counts=[usage.get('input_tokens'),usage.get('output_tokens')]
        if all(type(value) is int and value>=0 for value in counts):
            usage['total_tokens']=sum(counts)
    seq=0
    def event(kind,**values):
        nonlocal seq
        value=dict(type=kind,sequence_number=seq,**values);seq+=1
        return 'event: '+kind+'\ndata: '+json.dumps(value,ensure_ascii=False)+'\n\n'
    initial=dict(body,output=[],status='in_progress',usage=None)
    yield event('response.created',response=initial)
    yield event('response.in_progress',response=initial)
    for index,item in enumerate(body['output']):
        pending=copy.deepcopy(item)
        if item['type']=='message':pending['content']=[]
        elif item['type']=='function_call':pending['arguments']=''
        elif item['type']=='custom_tool_call':pending['input']=''
        pending['status']='in_progress'
        yield event('response.output_item.added',output_index=index,item=pending)
        if item['type']=='message':
            for content_index,part in enumerate(item['content']):
                if part.get('type')!='output_text':continue
                yield event('response.content_part.added',item_id=item['id'],output_index=index,
                    content_index=content_index,part=dict(part,text=''))
                yield event('response.output_text.delta',item_id=item['id'],output_index=index,
                    content_index=content_index,delta=part['text'])
                yield event('response.output_text.done',item_id=item['id'],output_index=index,
                    content_index=content_index,text=part['text'])
                yield event('response.content_part.done',item_id=item['id'],output_index=index,
                    content_index=content_index,part=part)
        elif item['type']=='function_call':
            yield event('response.function_call_arguments.delta',item_id=item['id'],output_index=index,delta=item['arguments'])
            yield event('response.function_call_arguments.done',item_id=item['id'],output_index=index,arguments=item['arguments'])
        elif item['type']=='custom_tool_call':
            yield event('response.custom_tool_call_input.delta',item_id=item['id'],output_index=index,delta=item['input'])
            yield event('response.custom_tool_call_input.done',item_id=item['id'],output_index=index,input=item['input'])
        yield event('response.output_item.done',output_index=index,item=item)
    yield event('response.completed',response=body)

def chat_events(body):
    choice=body['choices'][0];message=choice['message']
    chunk=dict(id=body['id'],object='chat.completion.chunk',created=body['created'],model=body['model'])
    yield 'data: '+json.dumps(dict(chunk,choices=[dict(index=0,delta=message,finish_reason=None)]))+'\n\n'
    yield 'data: '+json.dumps(dict(chunk,choices=[dict(index=0,delta={},finish_reason=choice['finish_reason'])],usage=body.get('usage')))+'\n\n'
    yield 'data: [DONE]\n\n'
