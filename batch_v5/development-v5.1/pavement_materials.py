"""Walking-scale paving shaders; photographic microdetail retains v4 credits."""

def build(road_materials, specs):
    result = {}
    aliases = {'walk_slabs': 'concrete_slabs', 'stone_slabs': 'concrete_slabs',
               'small_sett': 'sett', 'mosaic': 'sett'}
    defaults = {'walk_slabs': (.42, .41, .38), 'stone_slabs': (.42, .40, .35),
                'small_sett': (.32, .32, .29), 'mosaic': (.37, .36, .32),
                'paving_blocks': (.36, .35, .32), 'sett': (.32, .32, .29)}
    for key, spec in specs.items():
        family = spec['family']; base, scale = road_materials[aliases.get(family, family)]
        mat = base.copy();mat.name = 'Pavement / '+key
        n, l = mat.node_tree.nodes, mat.node_tree.links
        brick = next((node for node in n if node.type == 'TEX_BRICK'), None)
        if brick:
            width = spec.get('unit_metres') or {'walk_slabs': .50, 'stone_slabs': .60,
                'small_sett': .09, 'mosaic': .05, 'sett': .18, 'paving_blocks': .20}.get(family, .20)
            brick.inputs['Brick Width'].default_value = width
            brick.inputs['Row Height'].default_value = width if family in {'walk_slabs', 'stone_slabs', 'small_sett', 'mosaic'} else width*.5
            brick.inputs['Mortar Size'].default_value = min(.006, width*.035)
            brick.inputs['Mortar Smooth'].default_value = min(.002, width*.01)
            if family in {'walk_slabs', 'stone_slabs'}:
                brick.offset = 0
        rgb = spec.get('colour')
        if rgb:
            rgb = tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb)
        else:
            rgb = defaults.get(family)
        if rgb:
            p = n.get('Principled BSDF');socket = p.inputs['Base Color']
            old = socket.links[0].from_socket
            bw = n.new('ShaderNodeRGBToBW');l.new(old, bw.inputs[0])
            # Normalise the inherited shader luminance, retaining its joints,
            # scan microdetail and stains while applying a pavement palette.
            gain = n.new('ShaderNodeMath');gain.operation = 'MULTIPLY';gain.inputs[1].default_value = 3
            l.new(bw.outputs[0], gain.inputs[0])
            tint = n.new('ShaderNodeMixRGB');tint.blend_type = 'MULTIPLY';tint.inputs[0].default_value = 1
            l.new(gain.outputs[0], tint.inputs[1]);tint.inputs[2].default_value = (*rgb, 1)
            l.new(tint.outputs[0], socket)
        result[key] = (mat, scale)
    return result
