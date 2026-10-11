"""Run setup in TD Textport, then finish_syphon_verification() after several frames."""
exec((root / 'test/td/create_sketch_fixture.py').read_text())
exec((root / 'test/td/verify_sketch_fixture.py').read_text())
syphon_node = sketch_fixture.op('sketch1')
syphon_source = sketch_fixture.op('sketch')
syphon_original = syphon_source.text
syphon_source.text = "function setup(p){p.textSize(18)} function draw(p,f){p.background(0,255,0);p.noStroke();p.fill(255,0,0);p.rect(0,0,p.width,p.height/2);p.fill(255);p.text('Dawn + Rust',36,28)}"
syphon_node.par.Syphonname = 'avTools verified ' + str(__import__('os').getpid())
syphon_node.par.Syphonenabled = True
syphon_node.par.Syphononly = True
syphon_receiver = sketch_fixture.create(syphonspoutinTOP,'syphon_receiver')
syphon_receiver.par.sendername.expr = "'avTools Embedded:' + op('sketch1').par.Syphonname.eval()"
sketch_fixture.op('out1').inputConnectors[0].connect(syphon_receiver)
# out2 already requests the second CPU instance; this request starts the CPlusPlus publisher.
syphon_node.cook(force=True)
syphon_receiver.openViewer()
def finish_syphon_verification():
    import numpy as np
    syphon_receiver.cook(force=True)
    data = np.rint(syphon_receiver.numpyArray(delayed=False)*255).astype('uint8')
    assert data.shape == (79,191,4), data.shape
    # TD numpy arrays use a bottom-left origin. Match the CPU TOP's visual orientation.
    assert data[-2,2].tolist() == [255,0,0,255], data[-2,2]
    assert data[2,2].tolist() == [0,255,0,255], data[2,2]
    info = sketch_fixture.op('info1'); info.cook(force=True)
    result = dict(passed=True,width=191,height=79,top=data[-2,2].tolist(),bottom=data[2,2].tolist(),info=info.text)
    (output/'sketch-syphon-editor-verification.json').write_text(json.dumps(result,indent=2))
    print(result)
    syphon_receiver.closeViewer()
    syphon_node.par.Syphononly = False
    syphon_node.par.Syphonenabled = False
    syphon_source.text = syphon_original
    sketch_fixture.op('out1').inputConnectors[0].connect(syphon_node)
    syphon_receiver.destroy()
    syphon_node.cook(force=True)
    sketch_fixture.save(str(output/'sketch-operators.tox'))
