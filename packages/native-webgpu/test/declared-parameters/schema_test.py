import importlib.util
from pathlib import Path
import unittest
path = Path(__file__).resolve().parents[2] / 'native/td/DeclaredParameters.py'
spec = importlib.util.spec_from_file_location('parameters', path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Schema(unittest.TestCase):
    def test_all_types_roundtrip(self):
        raw = {'Controller': {'type':'midiInput'}, 'Speed': {'type':'float', 'default':-2}, 'Count':{'type':'int'}, 'Enabled':{'type':'toggle','default':True}, 'Title':{'type':'string','default':'你好 "hello"'}, 'Mode':{'type':'menu','options':['a','b']}, 'Color':{'type':'rgb','default':[1,0,0]}, 'Point':{'type':'xy'}, 'Space':{'type':'xyz'}, 'Tint':{'type':'rgba'}, 'Trigger':{'type':'pulse'}}
        value=m.validate(raw)
        self.assertEqual(value,m.validate(value))
        self.assertEqual(len(m.rows(value).splitlines()),11)
    def test_invalid(self):
        for value in [{'Controller':{'type':'midiInput','default':123}},{'speed':{'type':'float'}},{'Reset':{'type':'pulse'}},{'Infoview':{'type':'string'}},{'Speed':{'type':'float','default':float('nan')}},{'Speed':{'type':'float','min':2,'max':1}},{'Test':{'type':'xy','default':[1]}},{'Test':{'type':'menu','options':['a','a']}},{'Test':{'type':'toggle','default':1}},{'Test':{'type':'int','default':1.5}},{'Color':{'type':'rgb'},'Colorr':{'type':'float'}},{'Test':{'type':'string','label':'bad\tlabel'}},{'Test':{'type':'pulse','default':1}}]:
            with self.subTest(value=value),self.assertRaises(ValueError):m.validate(value)
    def test_storage_not_changed_on_invalid_schema(self):
        class Node:
            def __init__(self):self.data={m.KEY:m.validate({'Speed':{'type':'float'}})}
            def fetch(self,k,default,search=False):return self.data.get(k,default)
            def store(self,k,v):self.data[k]=v
        node=Node()
        self.assertTrue(m.dispatch(node,'schedule','{"Speed":{"type":"string"}}').startswith('ERROR:'))
        self.assertNotIn(m.PENDING,node.data)
        self.assertEqual(m.dispatch(node,'schedule','{"Speed":{"type":"float"}}'),'same')

if __name__=='__main__':unittest.main()
