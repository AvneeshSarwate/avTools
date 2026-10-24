"""TD-thread-only schema validation and deferred native parameter recreation.

No Python calls occur in the steady-state parameter sampling path.
"""
import json
import math
import re
import uuid

KEY = 'avtools.parameters.v1'
PENDING = KEY + '.pending'
REBUILDING = KEY + '.rebuilding'
RESERVED = set('Typescript Projectdir Entry Autobuild Autoreload Buildproject Createtemplate Templatedir Sketch Sourcefile Controls Width Height Eventname Sendpulse Reset Reload Outputchannels Outputsamples Samecook Pretrigger Pretriggerpulse Syphonname Syphonenabled Syphononly Infoview Clearlogs Refreshlogs Loglevel Clearlog Copylog Logdat Loglimit'.split())
KINDS = {'float': 1, 'int': 1, 'toggle': 1, 'string': 1, 'menu': 1, 'xy': 2, 'xyz': 3, 'rgb': 3, 'rgba': 4, 'pulse': 0}


def clean_text(value, description, limit=256):
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError(description + ' must be text without control characters')
    return value


def validate(raw):
    if not isinstance(raw, dict) or len(raw) > 64:
        raise ValueError('parameters must be an object with at most 64 controls')
    result = {}
    occupied = set(RESERVED)
    for name, spec in raw.items():
        if not re.fullmatch(r'[A-Z][a-z0-9]*', name) or name in occupied or name in {'Custom', 'Reinitpulse'}:
            raise ValueError('Invalid/reserved parameter name: ' + name + ' (use an uppercase first letter, then lowercase letters/digits)')
        if not isinstance(spec, dict) or spec.get('type') not in KINDS:
            raise ValueError(name + ': unsupported parameter type')
        unknown = set(spec) - {'type', 'label', 'page', 'default', 'min', 'max', 'clamp', 'options', 'labels'}
        if unknown:
            raise ValueError(name + ': unknown fields: ' + ', '.join(sorted(unknown)))
        kind = spec['type']
        count = KINDS[kind]
        suffix = {'xy': 'xy', 'xyz': 'xyz', 'rgb': 'rgb', 'rgba': 'rgba'}.get(kind, '')
        names = [name] + [name + c for c in suffix]
        if any(n in occupied for n in names):
            raise ValueError(name + ': tuple member conflicts with another parameter')
        occupied.update(names)
        out = {'type': kind, 'label': clean_text(spec.get('label', name), name + ' label'), 'page': clean_text(spec.get('page', 'Controls'), name + ' page', 64)}
        if not out['page'] or out['page'] in {'Build', 'Script', 'Sketch', 'Output', 'Logging', 'Common', 'CPlusPlus'}:
            raise ValueError(name + ': choose a separate script parameter page (default Controls)')
        if kind == 'pulse':
            if set(spec) - {'type', 'label', 'page'}:
                raise ValueError(name + ': pulse accepts only type, label and page')
        elif kind in ('string', 'menu'):
            out['default'] = clean_text(spec.get('default', ''), name + ' default', 4096)
            if kind == 'menu':
                options = spec.get('options')
                if not isinstance(options, list) or not 1 <= len(options) <= 128:
                    raise ValueError(name + ': menu needs 1–128 options')
                out['options'] = [clean_text(x, name + ' option') for x in options]
                if any(not x for x in options) or len(set(options)) != len(options):
                    raise ValueError(name + ': menu options must be nonempty and unique')
                labels = spec.get('labels', options)
                if not isinstance(labels, list) or len(labels) != len(options):
                    raise ValueError(name + ': labels must match options')
                out['labels'] = [clean_text(x, name + ' label') for x in labels]
                out['default'] = spec.get('default', options[0])
                if out['default'] not in options:
                    raise ValueError(name + ': default must be a menu option')
        elif kind == 'toggle':
            if not isinstance(spec.get('default', False), bool):
                raise ValueError(name + ': toggle default must be boolean')
            out['default'] = spec.get('default', False)
        else:
            def number(x):
                if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or abs(x) > 1e30:
                    raise ValueError(name + ': numeric values must be finite and within ±1e30')
                return x
            value = spec.get('default', 0 if count == 1 else [0] * count)
            vals = [value] if count == 1 else value
            if not isinstance(vals, list) or len(vals) != count:
                raise ValueError(name + ': default has wrong tuple size')
            vals = [number(v) for v in vals]
            if kind == 'int' and (vals[0] != int(vals[0]) or not -2147483648 <= vals[0] <= 2147483647):
                raise ValueError(name + ': default must be a 32-bit integer')
            out['default'] = vals[0] if count == 1 else vals
            out['min'] = number(spec.get('min', 0))
            out['max'] = number(spec.get('max', 1))
            if out['min'] >= out['max']:
                raise ValueError(name + ': min must be less than max')
            if not isinstance(spec.get('clamp', False), bool):
                raise ValueError(name + ': clamp must be boolean')
            out['clamp'] = spec.get('clamp', False)
        result[name] = out
    return result


def rows(schema):
    # ASCII TSV transport to the native setup callback; hex handles arbitrary text.
    def text(s): return s.encode('utf-8').hex()
    lines = []
    for name, p in schema.items():
        kind = p['type']
        default = p.get('default', 0)
        vals = default if isinstance(default, list) else [default]
        numeric = kind not in ('string', 'menu')
        fields = [name, kind, text(p['label']), text(p['page']), str(KINDS[kind])]
        fields += [str(float(vals[i])) if numeric and i < len(vals) else '0' for i in range(4)]
        fields += [str(p.get('min', 0)), str(p.get('max', 1)), str(int(p.get('clamp', False))), text(default) if not numeric else '-', str(len(p.get('options', [])))]
        for option, label in zip(p.get('options', []), p.get('labels', [])):
            fields += [text(option), text(label)]
        lines.append('\t'.join(fields))
    return '\n'.join(lines)


def rebuild(node_id, token):
    from td import op
    node = op(node_id)
    if node is None:
        return
    pending = node.fetch(PENDING, None, search=False)
    if not pending or pending['token'] != token:
        return
    node.store(KEY, pending['schema'])
    node.store(REBUILDING, True)
    try:
        node.par.reinitpulse.pulse()
    finally:
        node.unstore(REBUILDING)
        node.unstore(PENDING)


def dispatch(node, action, payload):
    try:
        if action == 'setup':
            return rows(validate(node.fetch(KEY, {}, search=False)))
        if action == 'rebuilding':
            return '1' if node.fetch(REBUILDING, False, search=False) else '0'
        if action == 'schedule':
            schema = validate(json.loads(payload))
            previous = validate(node.fetch(KEY, {}, search=False))
            for name in previous.keys() & schema.keys():
                if previous[name]['type'] != schema[name]['type']:
                    raise ValueError(name + ': changing parameter type requires a new name; existing values/connections are preserved')
            if schema == previous:
                return 'same'
            token = uuid.uuid4().hex
            node.store(PENDING, {'token': token, 'schema': schema})
            from td import run
            # C++ instance must not be destroyed inside its own callback.
            run('args[0](args[1], args[2])', rebuild, node.id, token, delayFrames=1)
            return 'scheduled'
        raise ValueError('Unknown schema action')
    except Exception as error:
        return 'ERROR:' + str(error)
