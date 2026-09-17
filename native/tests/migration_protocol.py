"""Native migration integration checks. Uses public model fixtures only."""
import argparse,array,base64,json,os,pathlib,subprocess,tempfile,wave
p=argparse.ArgumentParser();p.add_argument('--app',required=True);p.add_argument('--models',required=True);p.add_argument('--screens',default='');args=p.parse_args()
app=str(pathlib.Path(args.app).resolve());models=pathlib.Path(args.models).resolve();repo=pathlib.Path(__file__).resolve().parents[2]
os.environ['QT_MEDIA_BACKEND']='windows'
def run(arguments,requests=None,timeout=120):
 r=subprocess.run([app,*arguments],input=None if requests is None else ''.join(json.dumps(x)+'\n' for x in requests),encoding='utf-8',capture_output=True,timeout=timeout)
 assert r.returncode==0,(r.returncode,r.stderr[-5000:],r.stdout[-2000:])
 return [json.loads(x) for x in r.stdout.splitlines() if x.startswith('{')],r.stderr
cases=['完全就是给拦柜用的','完全就是给懒鬼用的','这家店的拦柜很旧了','今天天气很好','今天天汽很好','程序会自动更新','你找到你最喜欢的工作，我也很高心。','请打开 GitHub，版本是 v0.1.9。','我想使用完整词库','这个软件可以提高工作效率','我们明天早上九点开会','请支付一百二十三元','张晓明正在调试 Vocal']
expected=cases.copy();expected[0]='完全就是给懒鬼用的';expected[4]='今天天气很好';expected[6]='你找到你最喜欢的工作，我也很高兴。'
requests=[dict(type='correct',id=i,text=t,dictionaryEnabled=True,hotwords=['张晓明','Vocal']) for i,t in enumerate(cases)]
events,_=run(['--correction-worker','--model-dir',str(models),'--dictionary',str(repo/'resources/dictionaries/rime-ice/catalog.json')],requests)
assert [e['text'] for e in events if e['type']=='result']==expected,events
print('PASS MacBERT: 3 corrections and 10 unchanged/protected sentences',flush=True)
# Explicitly disabled dictionary still runs the CSC confidence guards.
events,_=run(['--correction-worker','--model-id','bert-chinese-int8','--model-dir',str(models),'--dictionary',str(repo/'resources/dictionaries/rime-ice/catalog.json')],requests)
results=[e['text'] for e in events if e['type']=='result']
assert results[4]==expected[4],results
for i in [1,2,3,5,7,8,9,10,11,12]:assert results[i]==cases[i],(i,results[i])
print('PASS BERT: weather example and all unchanged/protected sentences',flush=True)
fixture=models/'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/test_wavs/zh.wav'
with wave.open(str(fixture)) as w:
 rate=w.getframerate();assert rate==16000 and w.getsampwidth()==2 and w.getnchannels()==1
 samples=array.array('f',(s/32768 for s in array.array('h',w.readframes(w.getnframes()))))
commands=[dict(type='start',id=1)]
for at in range(0,len(samples),1600):commands.append(dict(type='audio',id=1,sampleRate=rate,samples=base64.b64encode(samples[at:at+1600].tobytes()).decode()))
commands.append(dict(type='finish',id=1))
events,_=run(['--stream-worker','--model-id','paraformer-zh-en','--model-dir',str(models)],commands)
assert any(e['type']=='partial' and e['text'] for e in events),events
assert '九点' in events[-1]['text'],events[-1]
print('PASS streaming Paraformer: incremental PCM, partial text, final result',flush=True)
with tempfile.TemporaryDirectory(prefix='vocal-pipeline-') as temp:
 directory=pathlib.Path(temp);pcm=directory/'speech.f32';pcm.write_bytes(samples.tobytes())
 (directory/'settings.json').write_text(json.dumps(dict(dictionaryAutoUpdate=False)),encoding='utf8')
 events,stderr=run(['--model-dir',str(models),'--data-dir',temp,'--pipeline-test',str(pcm)])
 assert events and events[-1]['type']=='pipeline-result' and '九点' in events[-1]['text'] and events[-1]['history']==1,(events,stderr)
 print('PASS C++ pipeline: offline recognition, punctuation, correction, cleanup, history',flush=True)
 # Two sessions must show fresh frames and retain the overlay at hotkey release.
 for layout in ['compact','full']:
  with tempfile.TemporaryDirectory(prefix='vocal-transition-') as ui_temp:
   (pathlib.Path(ui_temp)/'settings.json').write_text(json.dumps(dict(dictionaryAutoUpdate=False,correctionModel='none')),encoding='utf8')
   _,stderr=run(['--model-dir',str(models),'--data-dir',ui_temp,'--smoke-overlay',layout,'--smoke-overlay-pipeline',str(pcm),'--smoke-test',str(directory/f'overlay-{layout}.png')])
   assert 'Overlay recording-to-finishing continuity: true' in stderr,stderr
  print(f'PASS overlay {layout}: two fresh entrances and recording-to-finishing continuity',flush=True)
 # Two queued utterances must be committed in order to one history entry.
 events,stderr=run(['--model-dir',str(models),'--data-dir',temp,'--pipeline-test',str(pcm),'--pipeline-segments','2'])
 assert events[-1]['text'].count('九点')==2 and events[-1]['history']==2,(events,stderr)
 print('PASS consecutive segments: ordered final text and one session history',flush=True)
 (directory/'settings.json').write_text(json.dumps(dict(dictionaryAutoUpdate=False,modelId='none',streamingModel='paraformer-zh-en',correctionModel='none')),encoding='utf8')
 events,stderr=run(['--model-dir',str(models),'--data-dir',temp,'--pipeline-test',str(pcm)])
 assert '九点' in events[-1]['text'] and events[-1]['history']==3,(events,stderr)
 print('PASS streaming-only pipeline with punctuation and history',flush=True)
 # An intentionally silent session is a normal no-op, including with streaming enabled.
 silence=directory/'silence.f32';silence.write_bytes(bytes(rate*4))
 for streaming in ['none','paraformer-zh-en']:
  (directory/'settings.json').write_text(json.dumps(dict(dictionaryAutoUpdate=False,streamingModel=streaming,correctionModel='none')),encoding='utf8')
  events,stderr=run(['--model-dir',str(models),'--data-dir',temp,'--pipeline-test',str(silence)])
  assert events[-1]['text']=='' and events[-1]['error']=='' and events[-1]['history']==3,(events,stderr)
 print('PASS silent sessions: no error, no text, no new history with/without streaming',flush=True)

if args.screens:
 output=pathlib.Path(args.screens).resolve();output.mkdir(parents=True,exist_ok=True)
 for theme in ['light','dark']:
  for page in range(9):
   with tempfile.TemporaryDirectory(prefix='vocal-ui-') as temp:
    directory=pathlib.Path(temp)
    (directory/'settings.json').write_text(json.dumps(dict(dictionaryAutoUpdate=False,correctionModel='none',theme=theme)),encoding='utf8')
    (directory/'history.jsonl').write_text(json.dumps(dict(text='完全就是给懒鬼用的。',time='2026-09-17T10:00:00',duration=3500,segments=1,target='notepad.exe'),ensure_ascii=False)+'\n',encoding='utf8')
    ui_args=['--model-dir',str(models),'--data-dir',temp,'--smoke-test',str(output/f'{theme}-{page}.png'),'--smoke-page',str(page)]
    if theme=='light' and page==8:ui_args.append('--smoke-resource-refresh')
    _,stderr=run(ui_args)
    assert not any(x in stderr for x in ['ReferenceError','TypeError','Binding loop','Unable to assign','failed to load component']),(theme,page,stderr)
    print(f'PASS UI {theme} page {page}',flush=True)
  for layout in ['compact','full']:
   with tempfile.TemporaryDirectory(prefix='vocal-overlay-') as temp:
    (pathlib.Path(temp)/'settings.json').write_text(json.dumps(dict(dictionaryAutoUpdate=False,correctionModel='none',theme=theme)),encoding='utf8')
    _,stderr=run(['--model-dir',str(models),'--data-dir',temp,'--smoke-test',str(output/f'{theme}-overlay-{layout}.png'),'--smoke-overlay',layout])
    assert not any(x in stderr for x in ['ReferenceError','TypeError','Binding loop','Unable to assign','failed to load component']),(theme,layout,stderr)
    print(f'PASS overlay {theme} {layout}',flush=True)
