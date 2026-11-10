import json
from odoo import http
from odoo.http import request,Response
from odoo.exceptions import AccessError,UserError
from ..compat import chat_request,chat_response,response_events,chat_events

class RoutingController(http.Controller):
    @http.route('/caf_ai_routing/v1/status',type='http',auth='caf_inference',
        methods=['GET'],csrf=False,save_session=False)
    def status(self,**kw):
        # Configuration readiness only: no paid call or promise of provider uptime.
        if not request.httprequest.headers.get('Authorization','').startswith('Bearer '):
            return self._json({'error':{'message':'Se requiere credencial de servicio.'}},401)
        user=request.env.user
        if not user.has_group('base.group_user'):
            return self._json({'error':{'message':'Servicio o empresa no autorizado.'}},403)
        policy=request.env['caf.ai.routing.policy'].sudo().search([
            ('company_id','=',request.env.company.id),('active','=',True)],limit=1)
        return self._json({'configured':bool(policy),'selection':'task_policy',
            'primary':'openai','fallback':'vps','live_provider_check':False})
    @http.route(['/caf_ai_routing/v1/<string:stage>/responses',
                 '/caf_ai_routing/v1/<string:stage>/chat/completions'],
        type='http',auth='caf_inference',methods=['POST'],csrf=False,save_session=False)
    def response(self,stage,**kw):
        # Never allow a browser session to substitute for the server's API token.
        if not request.httprequest.headers.get('Authorization','').startswith('Bearer '):
            return self._json({'error':{'message':'Se requiere credencial de servicio.'}},401)
        if request.httprequest.content_length and request.httprequest.content_length>8*1024*1024:
            return self._json({'error':{'message':'Solicitud superior al límite.'}},413)
        try:
            body=request.httprequest.get_json()
            is_chat=request.httprequest.path.endswith('/chat/completions')
            stream=bool(body.get('stream'))
            converted=chat_request(body) if is_chat else body
            seconds=converted.pop('caf_timeout_seconds',None)
            policy=request.env['caf.ai.routing.policy'].with_context(
                caf_executor_cwd=request.httprequest.headers.get('X-CAF-Executor-Cwd'))
            result=policy.execute_response(converted,stage=stage,timeout=seconds)
            if is_chat:result=chat_response(result)
            headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'}
            if stream:
                return Response(''.join(chat_events(result) if is_chat else response_events(result)),
                    headers=headers,content_type='text/event-stream; charset=utf-8')
            return self._json(result)
        except AccessError:
            return self._json({'error':{'message':'Servicio o empresa no autorizado.'}},403)
        except (UserError,ValueError,TypeError,KeyError,AttributeError):
            # No endpoint, prompt, secret, external provider body or stack trace.
            return self._json({'error':{'message':'La política IA no completó la solicitud. Consulte Consumo y respaldos.'}},502)
    def _json(self,body,status=200):
        return Response(json.dumps(body,ensure_ascii=False),status=status,
            content_type='application/json',headers={'Cache-Control':'no-store'})
