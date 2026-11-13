"""Additional disposable fixture, isolated from user operators and correctness fixtures."""
bench = (op('/project1') or op('/')).create(baseCOMP, 'avtools_sketch_benchmark_' + str(int(time.time())))
page = bench.appendCustomPage('Benchmark')
page.appendToggle('Gpu', label='Syphon Only')[0].val = False
src = bench.create(textDAT, 'sketch')
src.text = "function setup(p){p.textSize(48);}function draw(p,f){p.background(f.frame%256,80,160);p.noStroke();p.fill(255);p.text('Dawn + Rust embedded',100,100);p.circle(960+Math.sin(f.frame/20)*400,540,200);p.fill(f.frame%256,40,200);p.rect(0,0,16,16);}"
b = bench.create(cplusplusTOP, 'renderer')
b.par.plugin = (root / 'build/td-plugin-path.txt').read_text().strip()
b.cook(force=True)
b.par.Sketch = src
b.par.Width = 1920
b.par.Height = 1080
b.par.Syphonname.expr = "'avTools TD benchmark ' + str(__import__('os').getpid())"
b.par.Syphonenabled.expr = 'parent().par.Gpu'
b.par.Syphononly.expr = 'parent().par.Gpu'
r = bench.create(syphonspoutinTOP, 'receiver')
r.par.sendername.expr = "'avTools Embedded:' + op('renderer').par.Syphonname.eval()"
switch = bench.create(switchTOP, 'select_transport')
switch.inputConnectors[0].connect(b)
switch.inputConnectors[1].connect(r)
switch.par.index.expr = 'parent().par.Gpu'
out = bench.create(outTOP, 'out1')
out.inputConnectors[0].connect(switch)
# CPlusPlus TOP does not honor custom-operator cookOnStart. Request its tiny
# placeholder output too, so publication starts even with an inactive CPU branch.
startup = bench.create(outTOP, 'out2')
startup.par.connectorder = 1
startup.inputConnectors[0].connect(b)
bench.save(str(output / 'sketch-benchmark.tox'))
print('Saved',output / 'sketch-benchmark.tox')
bench.destroy()
