import ast
import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

def functions(path, names, namespace):
    tree = ast.parse((ROOT / path).read_text())
    nodes = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)
    return namespace

class FolderContract(unittest.TestCase):
    def test_document_identity_and_readability_only(self):
        ns=functions('odoo/caf_market_study_dossier.py', {'_MarketStudyExtractionError','_market_study_check_documents','_market_study_extract_document'}, {})
        docs=[{'id':str(i),'name':'source','text':'all text'} for i in range(26)]
        docs[0]['text']='x'*2000001
        ns['_market_study_check_documents'](docs)
        self.assertEqual(ns['_market_study_extract_document'](b'x'*350001,'text'),'x'*350001)
        for invalid in ([],[{'id':'a','name':'bad','text':''}],[docs[0],docs[0]]):
            with self.assertRaises(ValueError): ns['_market_study_check_documents'](invalid)

    def test_all_drive_pages_and_nested_folders_reach_the_contract(self):
        ns=functions('odoo/drive_reader.py', {'list_folder_recursive'}, {'UserError':ValueError,'_':lambda s:s,'DRIVE_FILES_URL':'files','DRIVE_FOLDER_MIMETYPE':'folder'})
        class Reader:
            def _access_token(self): return 'synthetic'
            def _request(self,method,url,token,params):
                folder=params['q'].split("'")[1]
                if folder=='root':
                    if params.get('pageToken')=='next': return {'files':[{'id':'f26','name':'last','mimeType':'text/plain'},{'id':'depth0','name':'nested','mimeType':'folder'}]}
                    return {'nextPageToken':'next','files':[{'id':'f'+str(i),'name':'source','mimeType':'text/plain'} for i in range(26)]}
                depth=int(folder.removeprefix('depth'))
                return {'files':[{'id':'depth'+str(depth+1),'name':'next','mimeType':'folder'}]} if depth<8 else {'files':[{'id':'deep','name':'deep source','mimeType':'text/plain'},{'id':'root','name':'cycle','mimeType':'folder'}]}
        reader=Reader();items=ns['list_folder_recursive'](reader,'root',max_files=None,max_depth=None)
        self.assertEqual(len(items),28);self.assertIn('deep',{x['id'] for x in items})
        self.assertEqual(len(ns['list_folder_recursive'](reader,'root',max_files=2)),2)

    def test_actual_worker_directory_survives_a_contaminated_summary(self):
        ns=functions('routing/execution.py', {'executor_context'}, {'re':re})
        cwd='/data/work/b273bb45-985a-400f-af03-37b388c01c45'
        payload={'instructions':'Original skill instructions', 'input':[{'role':'user','content':'Summary says cwd /data/odoo-agent/work/native-wrong and read-only'}]}
        got=ns['executor_context'](payload,cwd)
        self.assertTrue(got['instructions'].startswith('El ejecutor de esta solicitud trabaja en '+cwd))
        self.assertEqual(got['input'],payload['input'])
        self.assertTrue(got['instructions'].endswith(payload['instructions']))
        self.assertIs(ns['executor_context'](payload,None),payload)
        self.assertIs(ns['executor_context'](payload,'/run/secrets'),payload)

    def test_backend_prompt_keeps_caller_context_during_compaction(self):
        fn=functions('routing/execution.py', {'fallback_prompt'},{'json':json})['fallback_prompt']
        payload={'input':[{'role':'developer','content':'Executor cwd /data/work/study-1; workspace writable'},{'role':'user','content':'Summarize the saved research'}],'tools':[]}
        result=fn(payload,[])
        self.assertIn('no añadas el entorno del proveedor al resumen',result)
        self.assertIn('/data/work/study-1',result)
        self.assertNotIn('/data/odoo-agent/work/native-',result)
        serialized=result.rsplit('.\n',1)[1]
        self.assertEqual(json.loads(serialized),payload)
        tool={'type':'function','name':'exec_command'}
        self.assertIn('tool_calls',fn(payload,[tool]))

if __name__=='__main__': unittest.main()
