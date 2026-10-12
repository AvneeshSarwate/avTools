"""Paste into ONE Execute DAT and enable Frame Start.

Place it in the component containing your sketches (recursive discovery), or
change scope() to return op('/project1'). Enable Pre-trigger Mode on participating
avTools TOPs. Other TOPs keep their normal behavior. No sleep or readiness polling.
"""


def scope():
    return parent()


def before_submit(nodes):
    # Optional: update CHOP controls or send event pulses before snapshots.
    pass


def between_passes(nodes):
    # Optional: cook useful independent project work here, for example:
    # op('other_content').cook(force=True)
    # Avoid branches that depend on these sketches: they would collect too early.
    # Do not add sleeps; a missing current result simply uses the previous output.
    pass


def _enabled(node):
    return (node.valid and not node.bypass
            and hasattr(node.par, 'Pretriggerpulse')
            and bool(node.par.Pretrigger.eval()))


def onFrameStart(frame):
    nodes = sorted((node for node in scope().findChildren(type=TOP, parName='Pretrigger')
                    if _enabled(node)), key=lambda node: node.path)
    before_submit(nodes)
    try:
        for node in nodes:
            if _enabled(node):
                node.par.Pretriggerpulse.pulse()
                node.cook(force=True)
        between_passes(nodes)
    finally:
        # TD can cache an earlier cook in the same frame: force collection.
        # Collect even if the user's intervening work raises an exception.
        for node in nodes:
            if _enabled(node):
                node.cook(force=True)
    return
