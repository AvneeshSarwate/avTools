from pathlib import Path
import json,traceback
repo=next(p for p in (Path(project.folder),*Path(project.folder).parents) if (p/'tools/td-native-build').is_dir())
root=parent();records=[]
def rows(node,suffix='_logs'):
    info=root.op(node.name+suffix);info.cook(force=True)
    return [[cell.val for cell in row] for row in info.rows()]
def messages(rows):return '\n'.join(r[4] for r in rows[1:])
def record(name,**values):records.append(dict(test=name,**values))
def refresh(node):node.par.Refreshlogs.pulse()
def steps():
    root.time.play=True
    for name,source in [('channels','channels.js'),('sketch','sketch.js')]:root.op(name+'_source').text=(repo/'packages/native-webgpu/native/td/logging-example'/source).read_text(encoding='utf-8')
    for name in ['channels','sketch']:
        node=root.op(name);node.viewer=True;node.par.Infoview='logs';node.par.Loglevel='debug';node.par.Reload.pulse();node.cook(force=True);yield .3
        r=rows(node);assert r[0]==['sequence','time_ms','generation','level','message'],r[:1]
        assert 'setup' in messages(r) and 'frame' in messages(r),r
        assert not node.errors(),node.errors()
        before=node.totalCooks;a=rows(node);b=rows(node,'_observer');assert node.totalCooks==before
        common={r[0]:r for r in a[1:]};assert all(common[r[0]]==r for r in b[1:] if r[0] in common)
        assert ('CHOP' if name=='channels' else 'TOP') in messages(a)
        assert ('TOP' if name=='channels' else 'CHOP') not in messages(a)
        record(name+'_isolation_observers',rows=len(a),source_cooks_during_read=node.totalCooks-before)
        node.par.Eventname='ErrorMessage';node.par.Sendpulse.pulse();node.cook(force=True);yield .2
        assert not node.errors(),node.errors();assert 'execution continues' in messages(rows(node))
        seq=int(rows(node)[-1][0]);gen=int(rows(node)[-1][2]);node.par.Reload.pulse();node.cook(force=True);yield .2
        r=rows(node);assert int(r[-1][0])>seq and int(r[-1][2])>gen
        node.par.Infoview='diagnostics';refresh(node);yield .1
        keys=[r[0] for r in rows(node)];assert all(k in keys for k in ['build_state','build_diagnostics','reload_state','source_identity','log_retained','log_evicted','log_dropped','log_truncated']),keys
        node.par.Infoview='logs';refresh(node);yield .1
        node.par.Eventname='Trigger';node.par.Sendpulse.pulse();node.cook(force=True);yield .15
        assert int(rows(node)[-1][0])>seq
        source=root.op(name+'_source');saved=source.text;source.text="console.info('before failed setup');function setup(){throw new Error('setup failure')}function draw(){}";node.cook(force=True);yield .2
        assert 'setup failure' in node.errors(),node.errors();assert 'before failed setup' in messages(rows(node))
        source.text=saved;node.cook(force=True);yield .2
        assert not node.errors(),node.errors();record(name+'_reload_error',generation=int(rows(node)[-1][2]))
    node=root.op('channels');node.par.Samecook=False;node.par.Reload.pulse();node.cook(force=True);yield .3
    refresh(node);yield .1
    assert 'CHOP setup' in messages(rows(node));node.par.Samecook=True
    top=root.op('sketch')
    for blocking,pretrigger in [(True,False),(False,True)]:
        top.par.Samecook=blocking;top.par.Pretrigger=pretrigger;top.par.Reload.pulse()
        if pretrigger:top.par.Pretriggerpulse.pulse()
        top.cook(force=True);yield .2
        refresh(top);yield .1
        assert 'TOP setup' in messages(rows(top))
    top.par.Pretrigger=False;top.par.Samecook=False;record('execution_modes',passed=True)
    source=root.op('sketch_source');saved=source.text
    source.text="async function setup(p,h){const b=h.device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});await b.mapAsync(GPUMapMode.READ);const a=new Float32Array(b.getMappedRange());b.unmap();console.log('detached',a);b.destroy()}function draw(p){p.background(0)}"
    top.cook(force=True);yield .3
    refresh(top);yield .1
    assert '[TypedArray: detached]' in messages(rows(top)),messages(rows(top))
    source.text=saved;top.cook(force=True);yield .3
    record('detached_GPU_buffer_preview',passed=True)
    # Stop playback and all downstream source evaluation, then allow a final
    # in-flight TOP to finish before freezing the comparison.
    root.time.play=False
    for name in ['channels','sketch']:root.op(name).viewer=False
    root.op('sketch').display=False
    yield .3
    for name in ['channels','sketch']:
        node=root.op(name);node.cook(force=True);yield .15
        node.cook(force=True);yield .15
        status=root.op(name+'_test_status') or root.create(infoCHOP,name+'_test_status');status.par.op=node.name;status.par.passive=True
        status.cook(force=True);native_before=float(status['cooks'][0]);frame_before=float(passive(node)['frames'][0]) if name=='channels' else None
        r=rows(node);seq=int(r[-1][0]);cached=root.op(name+'_logs').text;source_before=node.totalCooks
        yield .65
        unforced=root.op(name+'_logs').text;passive_rows=rows(node);passive_seq=int(passive_rows[-1][0]);assert node.totalCooks==source_before,('passive cook',source_before,node.totalCooks)
        refresh(node);yield .1
        updated=rows(node);assert int(updated[-1][0])>seq and 'independent timer' in messages(updated),('refresh stale',seq,updated[-1])
        status.cook(force=True);native_after=float(status['cooks'][0]);assert native_before==native_after,(native_before,native_after)
        if name=='channels':assert float(passive(node)['frames'][0])==frame_before
        record(name+'_paused',native_cooks_before=native_before,native_cooks_after=native_after,source_metadata_cooks=node.totalCooks-source_before,sequence_before=seq,passive_sequence=passive_seq,refreshed_sequence=int(updated[-1][0]),cached_changed_without_force=cached!=unforced)
        # Stop capture before clearing, so zero rows is deterministic with timers.
        node.par.Loglevel='off';refresh(node);yield .1
        node.par.Clearlogs.pulse();yield .1
        assert len(rows(node))==1,rows(node)
        node.par.Loglevel='debug';refresh(node);yield .4
        refresh(node);yield .1
        assert int(rows(node)[-1][0])>seq
        node.par.Reset.pulse();node.cook(force=True);yield .2
        record(name+'_clear_reset',passed=True)
    root.time.play=True
    # Rename doesn't change storage; delete a dedicated test instance with timers.
    node=root.op('channels');node.name='renamed_channels';yield .1
    node.name='channels';yield .1
    refresh(node);yield .1
    assert 'timer' in messages(rows(node))
    temp=root.create(cplusplusCHOP,'delete_pending');temp.par.plugin=node.par.plugin.eval();temp.cook(force=True);temp.par.Sketch='channels_source';temp.par.Outputchannels='ticks frames';temp.cook(force=True);yield .3
    temp.destroy();record('rename_delete_pending',passed=True)
    for name in ['channels','sketch']:root.op(name).viewer=True
    root.op('sketch').display=True
    return
iterator=steps()
def advance():
    try:
        delay=next(iterator)
        run("op(args[0]).module.advance()",me.path,delayMilliSeconds=delay*1000,delayRef=op.TDResources,wallTime=True)
    except StopIteration:finish(True)
    except Exception as e:finish(False,traceback.format_exc())
def finish(passed,error=None):
    result={'passed':passed,'build':app.build,'records':records,'error':error}
    (repo/'packages/native-webgpu/test/logging/td-result.json').write_text(json.dumps(result,indent=2));print('LOGGING VERIFICATION',result)
