# Print the Rocketbox skeleton's rest pose in metres (head positions), Blender's axes (Z up).
#   blender -b -P tools/blender/inspect_rig.py -- source-assets/rocketbox/Male_Adult_11/Male_Adult_11.fbx
import bpy, sys
path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=path)
for o in bpy.context.scene.objects:
    print('OBJ', o.type, o.name, tuple(round(v, 3) for v in o.scale), o.parent.name if o.parent else '-')
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
M = arm.matrix_world
for b in arm.data.bones:
    h = M @ b.head_local
    t = M @ b.tail_local
    print('BONE', b.name, '|', b.parent.name if b.parent else '-', '| head', tuple(round(v, 3) for v in h), 'tail', tuple(round(v, 3) for v in t))
for o in bpy.context.scene.objects:
    if o.type == 'MESH':
        print('MESH', o.name, len(o.data.vertices), 'verts', [m.name for m in o.data.materials], 'groups', len(o.vertex_groups))
