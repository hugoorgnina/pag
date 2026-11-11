import bpy, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=sys.argv[1])
tv=tt=0
for o in bpy.data.objects:
    if o.type=='MESH':
        m=o.data; m.calc_loop_triangles()
        tv+=len(m.vertices); tt+=len(m.loop_triangles)
        print('MESH',o.name,'verts',len(m.vertices),'tris',len(m.loop_triangles),'mats',[s.material.name if s.material else None for s in o.material_slots],'vgroups',len(o.vertex_groups),'shapekeys',len(m.shape_keys.key_blocks) if m.shape_keys else 0)
    elif o.type=='ARMATURE':
        print('ARMATURE',o.name,'bones',len(o.data.bones)); print('  ',[b.name for b in o.data.bones])
    else: print(o.type,o.name)
print('TOTAL verts',tv,'tris',tt)
import mathutils
mn=[1e9]*3; mx=[-1e9]*3
for o in bpy.data.objects:
    if o.type=='MESH':
        for v in o.data.vertices:
            w=o.matrix_world@v.co
            for i in range(3): mn[i]=min(mn[i],w[i]); mx[i]=max(mx[i],w[i])
print('bbox',mn,mx)
for mat in bpy.data.materials:
    imgs=[n.image.name for n in (mat.node_tree.nodes if mat.node_tree else []) if n.type=='TEX_IMAGE' and n.image]
    print('MAT',mat.name,imgs)
