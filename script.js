async function startFORMORA() {
  const $ = id => document.getElementById(id);
  const say = message => {
    $('status').textContent = message;
    $('hint').textContent = message;
  };

  try {
    const THREE = await import('three');

    const [
      { OrbitControls },
      { TransformControls },
      { RoundedBoxGeometry },
      { GLTFExporter },
      { GLTFLoader },
      { OBJLoader }
    ] = await Promise.all([
      import('three/addons/controls/OrbitControls.js'),
      import('three/addons/controls/TransformControls.js'),
      import('three/addons/geometries/RoundedBoxGeometry.js'),
      import('three/addons/exporters/GLTFExporter.js'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/OBJLoader.js')
    ]);

    // ==================================================
    // SCENE
    // ==================================================

    const viewport = $('viewport');
    viewport.style.position = 'relative';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#101116');

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(6, 5, 8);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true
    });

    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    viewport.appendChild(renderer.domElement);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0.8, 0);

    const transform = new TransformControls(camera, renderer.domElement);
    scene.add(transform.getHelper());

    const grid = new THREE.GridHelper(30, 30, 0x55506f, 0x292b35);
    scene.add(grid);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.25 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.025;
    ground.receiveShadow = true;
    scene.add(ground);

    scene.add(new THREE.HemisphereLight(0xc9c7ff, 0x30313c, 1.1));

    const keyLight = new THREE.DirectionalLight(0xffffff, 3);
    keyLight.position.set(5, 9, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0x888bff, 25, 35);
    fillLight.position.set(-6, 4, 3);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xffb9df, 18, 35);
    rimLight.position.set(2, 5, -6);
    scene.add(rimLight);

    const root = new THREE.Group();
    root.name = 'FORMORA Scene';
    scene.add(root);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    let selected = null;
    let mode = 'object';
    let viewerMode = false;
    let counter = 1;
    let globalOpacity = 1;
    let otherOpacity = 0.22;
    let shadowsEnabled = true;
    let studioLights = true;
    let wireframe = false;

    // Vertex control state
    let cornerMarkers = [];
    let extraDots = [];
    let activeDot = null;
    let draggingVertex = false;
    let draggedCorner = null;
    let dragPlane = new THREE.Plane();
    let dragOffset = new THREE.Vector3();
    let dragWorldPoint = new THREE.Vector3();
    let dragStartPositions = null;
    let dragStartLocal = null;
    let dragHistorySaved = false;

    const historyUndo = [];
    const historyRedo = [];
    const HISTORY_LIMIT = 35;

    function resize() {
      const w = Math.max(viewport.clientWidth, 1);
      const h = Math.max(viewport.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    new ResizeObserver(resize).observe(viewport);
    resize();

    // ==================================================
    // MATERIALS AND OBJECTS
    // ==================================================

    function createMaterial(color = '#8b78ff') {
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.48,
        metalness: 0.15
      });
    }

    function createPart(geo, name, shape = 'custom', color = '#8b78ff') {
      const mesh = new THREE.Mesh(geo, createMaterial(color));
      mesh.name = name;
      mesh.userData.formoraPart = true;
      mesh.userData.shape = shape;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    function allParts() {
      const list = [];
      root.traverse(obj => {
        if (obj.isMesh && obj.userData.formoraPart) list.push(obj);
      });
      return list;
    }

    function geometry(type) {
      switch (type) {
        case 'box':
          return new THREE.BoxGeometry(1.5, 1.5, 1.5, 8, 8, 8);
        case 'sphere':
          return new THREE.SphereGeometry(0.85, 32, 24);
        case 'cylinder':
          return new THREE.CylinderGeometry(0.7, 0.7, 1.6, 24, 8);
        case 'cone':
          return new THREE.ConeGeometry(0.8, 1.7, 24, 8);
        case 'torus':
          return new THREE.TorusGeometry(0.7, 0.25, 16, 40);
        case 'capsule':
          return new THREE.CapsuleGeometry(0.5, 0.8, 6, 16);
        case 'knot':
          return new THREE.TorusKnotGeometry(0.6, 0.19, 72, 12);
        case 'plane':
          return new THREE.PlaneGeometry(1.7, 1.7, 12, 12);
        case 'ico':
          return new THREE.IcosahedronGeometry(0.9, 1);
        case 'octa':
          return new THREE.OctahedronGeometry(0.9, 1);
        case 'ring':
          return new THREE.RingGeometry(0.35, 0.85, 32);
        case 'pyramid':
          return new THREE.ConeGeometry(0.9, 1.5, 4, 4);
        default:
          return new THREE.BoxGeometry(1.5, 1.5, 1.5, 8, 8, 8);
      }
    }

    const shapeNames = {
      box: 'Cube',
      sphere: 'Sphere',
      cylinder: 'Cylinder',
      cone: 'Cone',
      torus: 'Torus',
      capsule: 'Capsule',
      knot: 'Torus knot',
      plane: 'Plane',
      ico: 'Icosahedron',
      octa: 'Octahedron',
      ring: 'Ring',
      pyramid: 'Pyramid'
    };

    function disposeObject(object) {
      object.traverse(child => {
        child.geometry?.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];

          mats.forEach(mat => {
            mat.map?.dispose();
            mat.dispose();
          });
        }
      });
    }

    // ==================================================
    // UNDO AND REDO
    // ==================================================

    function takeSnapshot() {
      return JSON.stringify(root.toJSON());
    }

    function checkpoint() {
      historyUndo.push(takeSnapshot());
      if (historyUndo.length > HISTORY_LIMIT) historyUndo.shift();
      historyRedo.length = 0;
      updateHistoryButtons();
    }

    function updateHistoryButtons() {
      if ($('undoBtn')) $('undoBtn').disabled = historyUndo.length === 0;
      if ($('redoBtn')) $('redoBtn').disabled = historyRedo.length === 0;
    }

    function restoreSnapshot(data) {
      try {
        transform.detach();
        clearAllMarkers();
        selected = null;

        const restored = new THREE.ObjectLoader().parse(JSON.parse(data));

        for (const child of [...root.children]) {
          root.remove(child);
          disposeObject(child);
        }

        for (const child of [...restored.children]) {
          root.add(child);
        }

        select(allParts()[0] || null);
        refreshHierarchy();
        say('History restored');
      } catch (error) {
        console.error(error);
        say('Could not restore that history step.');
      }
    }

    function undo() {
      if (!historyUndo.length) return say('Nothing to undo.');
      historyRedo.push(takeSnapshot());
      restoreSnapshot(historyUndo.pop());
      updateHistoryButtons();
    }

    function redo() {
      if (!historyRedo.length) return say('Nothing to redo.');
      historyUndo.push(takeSnapshot());
      restoreSnapshot(historyRedo.pop());
      updateHistoryButtons();
    }

    function addHistoryButtons() {
      const style =
        'padding:8px 10px;border:1px solid #393b48;border-radius:7px;' +
        'background:#22242e;color:white;cursor:pointer;margin-left:5px';

      const group = document.createElement('div');
      group.style.cssText = 'display:flex;align-items:center;gap:4px';

      const undoBtn = document.createElement('button');
      undoBtn.id = 'undoBtn';
      undoBtn.textContent = '↶ Undo';
      undoBtn.style.cssText = style;
      undoBtn.onclick = undo;

      const redoBtn = document.createElement('button');
      redoBtn.id = 'redoBtn';
      redoBtn.textContent = '↷ Redo';
      redoBtn.style.cssText = style;
      redoBtn.onclick = redo;

      const viewerBtn = document.createElement('button');
      viewerBtn.id = 'viewerBtn';
      viewerBtn.textContent = 'Viewer';
      viewerBtn.style.cssText = style;
      viewerBtn.onclick = toggleViewer;

      group.append(undoBtn, redoBtn, viewerBtn);
      document.querySelector('.header-buttons').appendChild(group);
    }

    // ==================================================
    // VERTEX MARKERS
    // ==================================================

    function uniquePositions(mesh) {
      const attr = mesh.geometry?.attributes?.position;
      if (!attr) return [];

      const unique = [];
      const eps = 0.0001;

      for (let i = 0; i < attr.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(attr, i);
        if (!unique.some(v => v.distanceTo(p) < eps)) unique.push(p);
      }

      return unique;
    }

    // A subdivided cube has hundreds of mesh vertices, but only eight corner handles.
    function cornerPositions(mesh) {
      if (!mesh?.geometry?.attributes?.position) return [];

      if (['box', 'roundedBox'].includes(mesh.userData.shape)) {
        mesh.geometry.computeBoundingBox();
        const b = mesh.geometry.boundingBox;
        if (!b) return [];

        const points = [];

        for (const x of [b.min.x, b.max.x]) {
          for (const y of [b.min.y, b.max.y]) {
            for (const z of [b.min.z, b.max.z]) {
              points.push(new THREE.Vector3(x, y, z));
            }
          }
        }

        return points;
      }

      // Other shapes use their actual distinct geometry vertices as handles.
      return uniquePositions(mesh);
    }

    function clearMarkerList(list) {
      list.forEach(marker => {
        scene.remove(marker);
        marker.geometry?.dispose();
        marker.material?.dispose();
      });

      list.length = 0;
    }

    function clearAllMarkers() {
      clearMarkerList(cornerMarkers);
      clearExtraDots();
    }

    function markerSphere(position, color, size = 0.035) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(size, 12, 10),
        new THREE.MeshBasicMaterial({ color, depthTest: false })
      );

      marker.position.copy(position);
      marker.renderOrder = 1000;
      scene.add(marker);
      return marker;
    }

    function refreshCornerMarkers() {
      clearMarkerList(cornerMarkers);
      clearExtraDots();

      if (!selected || !selected.isMesh || mode !== 'vertex' || viewerMode) return;

      selected.updateWorldMatrix(true, false);

      const corners = cornerPositions(selected);

      corners.forEach(localPos => {
        const worldPos = localPos.clone().applyMatrix4(selected.matrixWorld);
        const marker = markerSphere(worldPos, '#ffd66e', 0.038);
        marker.userData.isCornerMarker = true;
        cornerMarkers.push(marker);
      });

      // Automatically add three dots on each cube edge and one dot per face.
      // For other shapes, use the bounding-box edge and face points as useful handles.
      const box = new THREE.Box3().setFromBufferAttribute(
        selected.geometry.attributes.position
      );

      const min = box.min;
      const max = box.max;
      const eps = 0.0001;
      const isBox = ['box', 'roundedBox'].includes(selected.userData.shape);

      if (isBox) {
        const cornersForEdges = cornerPositions(selected);

        for (let i = 0; i < cornersForEdges.length; i++) {
          for (let j = i + 1; j < cornersForEdges.length; j++) {
            const a = cornersForEdges[i];
            const b = cornersForEdges[j];

            const diff = [
              Math.abs(a.x - b.x),
              Math.abs(a.y - b.y),
              Math.abs(a.z - b.z)
            ];

            if (diff.filter(v => v > eps).length !== 1) continue;

            for (let k = 1; k <= 3; k++) {
              makeExtraDot(a.clone().lerp(b, k / 4), 'edge');
            }
          }
        }

        const faceCenters = [
          new THREE.Vector3(min.x, (min.y + max.y) / 2, (min.z + max.z) / 2),
          new THREE.Vector3(max.x, (min.y + max.y) / 2, (min.z + max.z) / 2),
          new THREE.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2),
          new THREE.Vector3((min.x + max.x) / 2, max.y, (min.z + max.z) / 2),
          new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, min.z),
          new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, max.z)
        ];

        faceCenters.forEach(p => makeExtraDot(p, 'face'));
      } else {
        // Non-cube shapes receive evenly spaced points along their bounding-box edges
        // plus six face-center handles, keeping Vertex mode immediately usable.
        const bCorners = [];

        for (const x of [min.x, max.x]) {
          for (const y of [min.y, max.y]) {
            for (const z of [min.z, max.z]) {
              bCorners.push(new THREE.Vector3(x, y, z));
            }
          }
        }

        for (let i = 0; i < bCorners.length; i++) {
          for (let j = i + 1; j < bCorners.length; j++) {
            const a = bCorners[i];
            const b = bCorners[j];

            const diff = [
              Math.abs(a.x - b.x),
              Math.abs(a.y - b.y),
              Math.abs(a.z - b.z)
            ];

            if (diff.filter(v => v > eps).length !== 1) continue;

            for (let k = 1; k <= 3; k++) {
              makeExtraDot(a.clone().lerp(b, k / 4), 'edge');
            }
          }
        }

        [
          new THREE.Vector3(min.x, (min.y + max.y) / 2, (min.z + max.z) / 2),
          new THREE.Vector3(max.x, (min.y + max.y) / 2, (min.z + max.z) / 2),
          new THREE.Vector3((min.x + max.x) / 2, min.y, (min.z + max.z) / 2),
          new THREE.Vector3((min.x + max.x) / 2, max.y, (min.z + max.z) / 2),
          new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, min.z),
          new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, max.z)
        ].forEach(p => makeExtraDot(p, 'face'));
      }

      updateMarkerPositions();
    }

    function clearExtraDots() {
      extraDots.forEach(dot => {
        scene.remove(dot.marker);
        dot.marker.geometry.dispose();
        dot.marker.material.dispose();
      });

      extraDots = [];
      activeDot = null;
    }

    function makeExtraDot(localPosition, type = 'edge') {
      selected.updateWorldMatrix(true, false);

      const world = localPosition.clone().applyMatrix4(selected.matrixWorld);
      const color = type === 'face' ? '#ff8ed4' : '#5eead4';

      const marker = markerSphere(
        world,
        color,
        type === 'face' ? 0.034 : 0.031
      );

      marker.userData.isExtraDot = true;
      extraDots.push({
        marker,
        type,
        position: localPosition.clone()
      });
    }

    function updateMarkerPositions() {
      if (!selected?.isMesh) return;

      selected.updateWorldMatrix(true, false);

      const corners = cornerPositions(selected);

      while (cornerMarkers.length > corners.length) {
        const marker = cornerMarkers.pop();
        scene.remove(marker);
        marker.geometry.dispose();
        marker.material.dispose();
      }

      while (cornerMarkers.length < corners.length) {
        cornerMarkers.push(
          markerSphere(new THREE.Vector3(), '#ffd66e', 0.038)
        );
      }

      corners.forEach((p, i) => {
        cornerMarkers[i].position.copy(p).applyMatrix4(selected.matrixWorld);
      });

      extraDots.forEach(dot => {
        dot.marker.position.copy(dot.position).applyMatrix4(selected.matrixWorld);
      });
    }

    function createVertexPanel() {
      const panel = document.createElement('div');
      panel.id = 'vertexControls';

      panel.style.cssText =
        'position:absolute;top:58px;left:12px;z-index:10;width:215px;' +
        'padding:12px;border-radius:10px;border:1px solid #383a47;' +
        'background:rgba(23,24,32,.96);color:#fff;font:12px Arial,sans-serif;' +
        'display:none;';

      panel.innerHTML = `
        <strong style="display:block;margin-bottom:10px">VERTEX CONTROLS</strong>
        <button id="makeModelGroup" style="width:100%;padding:8px;margin-bottom:7px">
          Make selected a model
        </button>
        <p style="font-size:10px;line-height:1.5;color:#b8bac8;margin:0">
          Yellow = corners · Green = edge points · Pink = face centers.<br>
          All points appear automatically. Drag a point to reshape the selected part.
        </p>`;

      viewport.appendChild(panel);
      $('makeModelGroup').onclick = makeSelectedModelGroup;
    }

    // ==================================================
    // SELECTION, HIERARCHY AND MODES
    // ==================================================

    function updateOpacity() {
      allParts().forEach(object => {
        const selectedOrChild = selected && (
          object === selected ||
          selected.getObjectById(object.id) === object
        );

        const fade = selected && !selectedOrChild ? otherOpacity : 1;

        const mats = Array.isArray(object.material)
          ? object.material
          : [object.material];

        mats.forEach(mat => {
          mat.opacity = globalOpacity * fade;
          mat.transparent = mat.opacity < 0.999;
          mat.depthWrite = mat.opacity >= 0.999;
        });
      });
    }

    function refreshHierarchy() {
      const holder = $('hierarchy');
      holder.replaceChildren();

      const objects = [];

      root.traverse(object => {
        if (
          object !== root &&
          (
            object.isGroup ||
            (object.isMesh && object.userData.formoraPart)
          )
        ) {
          objects.push(object);
        }
      });

      $('noObjects').style.display = objects.length ? 'none' : 'block';

      objects.forEach(object => {
        const button = document.createElement('button');
        button.className = 'tree-item' + (object === selected ? ' selected' : '');
        button.textContent = (object.isGroup ? '▣  ' : '◆  ') + object.name;

        button.style.cssText =
          'display:block;width:100%;text-align:left;margin:3px 0;padding:7px';

        button.onclick = () => {
          if (!viewerMode) select(object);
        };

        holder.appendChild(button);
      });
    }

    function updateFields() {
      if (!selected) return;

      const put = (id, value) => {
        $(id).value = Number(value.toFixed(3));
      };

      put('px', selected.position.x);
      put('py', selected.position.y);
      put('pz', selected.position.z);

      put('sx', selected.scale.x);
      put('sy', selected.scale.y);
      put('sz', selected.scale.z);

      put('rx', THREE.MathUtils.radToDeg(selected.rotation.x));
      put('ry', THREE.MathUtils.radToDeg(selected.rotation.y));
      put('rz', THREE.MathUtils.radToDeg(selected.rotation.z));

      const mat = Array.isArray(selected.material)
        ? selected.material[0]
        : selected.material;

      if (mat?.color) {
        $('color').value = '#' + mat.color.getHexString();
      }

      if (mat?.metalness !== undefined) {
        $('metalness').value = mat.metalness;
        $('metalValue').textContent = mat.metalness.toFixed(2);
      }

      if (mat?.roughness !== undefined) {
        $('roughness').value = mat.roughness;
        $('roughValue').textContent = mat.roughness.toFixed(2);
      }
    }

    function select(object) {
      selected = object || null;
      transform.detach();
      clearAllMarkers();

      if (selected) {
        $('objectName').value = selected.name;
        updateFields();
      } else {
        $('objectName').value = '';
      }

      if (selected && mode === 'object' && !viewerMode) {
        transform.attach(selected);
      }

      if (selected && mode === 'vertex' && !viewerMode) {
        refreshCornerMarkers();
      }

      updateOpacity();
      refreshHierarchy();

      $('modeLabel').textContent = viewerMode
        ? 'VIEWER MODE'
        : mode === 'vertex'
          ? 'VERTEX MODE'
          : 'OBJECT MODE';

      $('status').textContent = selected
        ? `Selected: ${selected.name}`
        : `Ready · ${allParts().length} parts`;
    }

    function focus(object) {
      if (!object) return;

      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const distance = Math.max(size.x, size.y, size.z, 1) * 2.5;

      orbit.target.copy(center);

      camera.position.copy(center).add(
        new THREE.Vector3(distance, distance * 0.7, distance)
      );

      camera.lookAt(center);
      orbit.update();
    }

    function setMode(next) {
      mode = next;
      viewerMode = false;

      $('objectMode').classList.toggle('active', mode === 'object');
      $('vertexMode').classList.toggle('active', mode === 'vertex');

      $('modeLabel').textContent =
        mode === 'vertex' ? 'VERTEX MODE' : 'OBJECT MODE';

      transform.detach();
      clearAllMarkers();

      if (mode === 'object') {
        if (selected) transform.attach(selected);
      } else {
        if (selected?.isMesh) {
          refreshCornerMarkers();
        } else if (selected?.isGroup) {
          say(
            'Model group selected. Switch to Object mode to move the whole model, ' +
            'or select a part in the hierarchy to edit vertices.'
          );
        }
      }

      $('vertexControls').style.display =
        mode === 'vertex' ? 'block' : 'none';

      orbit.enabled = true;

      $('hint').textContent = mode === 'vertex'
        ? 'Drag yellow corner, green edge, or pink face dots to reshape your model. Drag empty space to orbit.'
        : 'Drag to orbit · Scroll to zoom · Select an object to edit.';
    }

    function toggleViewer() {
      viewerMode = !viewerMode;
      transform.detach();
      clearAllMarkers();

      $('viewerBtn').textContent = viewerMode ? 'Exit viewer' : 'Viewer';
      $('vertexControls').style.display = 'none';

      $('modeLabel').textContent = viewerMode
        ? 'VIEWER MODE'
        : mode.toUpperCase() + ' MODE';

      orbit.enabled = true;

      if (!viewerMode) {
        setMode(mode);
      } else {
        say('Viewer mode: drag to rotate, scroll to zoom, right-drag to pan.');
      }
    }

    function setTransformMode(name) {
      if (viewerMode || mode !== 'object') return;

      transform.setMode(name);

      $('moveBtn').classList.toggle('active', name === 'translate');
      $('rotateBtn').classList.toggle('active', name === 'rotate');
      $('scaleBtn').classList.toggle('active', name === 'scale');
    }

    transform.addEventListener('dragging-changed', event => {
      orbit.enabled = !event.value;
    });

    transform.addEventListener('objectChange', () => {
      updateFields();
    });

    // ==================================================
    // VERTEX DEFORMATION
    // ==================================================

    function updatePointer(event) {
      const rect = renderer.domElement.getBoundingClientRect();

      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
    }

    function closestVertexIndex(mesh, point) {
      const attr = mesh.geometry.attributes.position;

      let best = -1;
      let bestDistance = Infinity;

      for (let i = 0; i < attr.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(attr, i);
        const distance = p.distanceTo(point);

        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }

      return best;
    }

    function savePositions(mesh) {
      return mesh.geometry.attributes.position.array.slice();
    }

    function restorePositions(mesh, positions) {
      const attr = mesh.geometry.attributes.position;

      attr.array.set(positions);
      attr.needsUpdate = true;

      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }

    function deformAtLocalPoint(mesh, targetLocal, destinationLocal, radius) {
      const attr = mesh.geometry.attributes.position;
      const original = dragStartPositions;
      const delta = destinationLocal.clone().sub(targetLocal);

      // Smooth falloff: nearby vertices follow the control dot,
      // while distant vertices move less or remain unchanged.
      for (let i = 0; i < attr.count; i++) {
        const originalPoint = new THREE.Vector3(
          original[i * 3],
          original[i * 3 + 1],
          original[i * 3 + 2]
        );

        const distance = originalPoint.distanceTo(targetLocal);
        if (distance > radius) continue;

        const t = 1 - distance / radius;
        const weight = t * t * (3 - 2 * t);

        attr.setXYZ(
          i,
          originalPoint.x + delta.x * weight,
          originalPoint.y + delta.y * weight,
          originalPoint.z + delta.z * weight
        );
      }

      // Prevent duplicated face vertices from separating at the corners.
      // Vertices with the same original position receive the same movement.
      const eps = 0.0001;

      for (let i = 0; i < attr.count; i++) {
        const p = new THREE.Vector3(
          original[i * 3],
          original[i * 3 + 1],
          original[i * 3 + 2]
        );

        for (let j = i + 1; j < attr.count; j++) {
          const q = new THREE.Vector3(
            original[j * 3],
            original[j * 3 + 1],
            original[j * 3 + 2]
          );

          if (p.distanceTo(q) < eps) {
            attr.setXYZ(j, attr.getX(i), attr.getY(i), attr.getZ(i));
          }
        }
      }

      attr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }

    renderer.domElement.addEventListener('pointerdown', event => {
      if (event.button !== 0 || viewerMode || !selected) return;

      updatePointer(event);

      if (mode !== 'vertex') {
        if (transform.dragging) return;

        const hits = raycaster.intersectObjects(allParts(), false);

        if (hits.length) {
          select(hits[0].object);
        }

        return;
      }

      const markers = [
        ...cornerMarkers,
        ...extraDots.map(dot => dot.marker)
      ];

      raycaster.params.Points.threshold = 0.15;

      const markerHits = raycaster.intersectObjects(markers, false);

      if (markerHits.length) {
        const marker = markerHits[0].object;
        const extra = extraDots.find(dot => dot.marker === marker);

        activeDot = extra || null;
        draggedCorner = extra ? null : marker;
        draggingVertex = true;

        checkpoint();
        dragHistorySaved = true;
        dragStartPositions = savePositions(selected);

        selected.updateWorldMatrix(true, false);
        dragStartLocal = selected.worldToLocal(marker.position.clone());

        const worldPosition = marker.position.clone();

        camera.getWorldDirection(dragPlane.normal);
        dragPlane.setFromNormalAndCoplanarPoint(
          dragPlane.normal,
          worldPosition
        );

        if (raycaster.ray.intersectPlane(dragPlane, dragWorldPoint)) {
          dragOffset.copy(worldPosition).sub(dragWorldPoint);
        }

        orbit.enabled = false;
        event.preventDefault();
        return;
      }
    });

    renderer.domElement.addEventListener('pointermove', event => {
      if (!draggingVertex || !selected) return;

      updatePointer(event);

      if (!raycaster.ray.intersectPlane(dragPlane, dragWorldPoint)) return;

      const newWorld = dragWorldPoint.clone().add(dragOffset);

      selected.updateWorldMatrix(true, false);

      const newLocal = selected.worldToLocal(newWorld.clone());

      if (activeDot) {
        // Edge and face dots deform nearby surface vertices smoothly.
        const startLocal = dragStartLocal.clone();

        const radius = Math.max(
          selected.geometry.boundingSphere?.radius || 1,
          0.5
        ) * 0.85;

        deformAtLocalPoint(selected, startLocal, newLocal, radius);

        activeDot.position.copy(newLocal);
        updateMarkerPositions();
      } else if (draggedCorner) {
        // Softly pull nearby mesh vertices so even rounded corners respond.
        const startLocal = dragStartLocal.clone();

        deformAtLocalPoint(selected, startLocal, newLocal, 0.48);
        updateMarkerPositions();
      }
    });

    function finishVertexDrag() {
      if (!draggingVertex) return;

      draggingVertex = false;
      activeDot = null;
      draggedCorner = null;
      dragStartPositions = null;
      dragStartLocal = null;
      dragHistorySaved = false;

      orbit.enabled = true;
      updateMarkerPositions();
    }

    window.addEventListener('pointerup', finishVertexDrag);
    window.addEventListener('pointercancel', finishVertexDrag);

    // ==================================================
    // MODEL GROUPS
    // ==================================================

    function makeSelectedModelGroup() {
      if (!selected || viewerMode) return say('Select a part first.');

      if (selected.isGroup) {
        return say('This is already a model group. Add new shapes while it is selected.');
      }

      checkpoint();

      const part = selected;
      const parent = part.parent || root;
      const group = new THREE.Group();

      group.name = `${part.name} Model`;
      group.position.copy(part.position);
      group.rotation.copy(part.rotation);
      group.scale.copy(part.scale);

      parent.add(group);
      parent.remove(part);

      part.position.set(0, 0, 0);
      part.rotation.set(0, 0, 0);
      part.scale.set(1, 1, 1);

      group.add(part);

      select(group);

      say('Model group created. Add shapes while this model is selected; they will move together.');
    }

    function addShape(type) {
      if (viewerMode) return say('Exit Viewer mode to edit.');

      checkpoint();

      const mesh = createPart(
        geometry(type),
        `${shapeNames[type] || 'Object'} ${counter++}`,
        type
      );

      mesh.position.y =
        type === 'plane' || type === 'ring' ? 0.02 : 1;

      if (type === 'plane' || type === 'ring') {
        mesh.rotation.x = -Math.PI / 2;
      }

      const parentGroup = selected?.isGroup ? selected : root;

      parentGroup.add(mesh);

      if (parentGroup === root) {
        select(mesh);
        focus(mesh);
      } else {
        select(parentGroup);
        focus(parentGroup);
      }

      say(`${mesh.name} added${parentGroup !== root ? ' to model group' : ''}.`);
    }

    function duplicateSelected() {
      if (!selected || viewerMode) return say('Select an object first.');

      checkpoint();

      const copy = selected.clone(true);

      copy.traverse(child => {
        if (!child.isMesh) return;

        if (child.geometry) {
          child.geometry = child.geometry.clone();
        }

        if (child.material) {
          child.material = Array.isArray(child.material)
            ? child.material.map(m => m.clone())
            : child.material.clone();
        }
      });

      copy.name = `${selected.name} copy`;
      copy.position.x += 0.7;
      copy.position.z += 0.35;

      (selected.parent || root).add(copy);

      select(copy);
      say('Object duplicated.');
    }

    function deleteSelected() {
      if (!selected || viewerMode) return say('Select an object first.');

      checkpoint();

      const old = selected;

      select(null);
      old.parent?.remove(old);
      disposeObject(old);

      refreshHierarchy();
      say('Object deleted.');
    }

    function clearScene() {
      if (viewerMode) return say('Exit Viewer mode first.');
      if (!root.children.length) return say('Scene is already empty.');

      checkpoint();
      select(null);

      for (const child of [...root.children]) {
        root.remove(child);
        disposeObject(child);
      }

      refreshHierarchy();
      say('Scene cleared.');
    }

    // ==================================================
    // ROUNDNESS AND TRANSFORMS
    // ==================================================

    function applyRoundness() {
      if (!selected || viewerMode) return say('Select a cube first.');

      if (!['box', 'roundedBox'].includes(selected.userData.shape)) {
        return say('Roundness applies to cubes.');
      }

      checkpoint();

      const radius = Number($('roundness').value);
      const old = selected.geometry;

      selected.geometry = radius === 0
        ? new THREE.BoxGeometry(1.5, 1.5, 1.5, 8, 8, 8)
        : new RoundedBoxGeometry(1.5, 1.5, 1.5, 4, radius);

      selected.userData.shape = radius === 0 ? 'box' : 'roundedBox';

      old.dispose();

      clearAllMarkers();

      if (mode === 'vertex') {
        refreshCornerMarkers();
      }

      say('Roundness applied.');
    }

    $('roundness').oninput = () => {
      $('roundValue').textContent = Number($('roundness').value).toFixed(2);
    };

    $('roundBtn').onclick = applyRoundness;

    function editTransform(id, property, axis, degrees = false) {
      if (!selected || viewerMode) return;

      let value = Number($(id).value);

      if (!Number.isFinite(value)) return;

      checkpoint();

      if (degrees) {
        value = THREE.MathUtils.degToRad(value);
      }

      if (property === 'scale') {
        value = Math.max(0.05, value);
      }

      selected[property][axis] = value;

      updateFields();
      updateMarkerPositions();
    }

    [
      ['px', 'position', 'x'],
      ['py', 'position', 'y'],
      ['pz', 'position', 'z'],
      ['sx', 'scale', 'x'],
      ['sy', 'scale', 'y'],
      ['sz', 'scale', 'z'],
      ['rx', 'rotation', 'x', true],
      ['ry', 'rotation', 'y', true],
      ['rz', 'rotation', 'z', true]
    ].forEach(([id, property, axis, degrees]) => {
      $(id).addEventListener('change', () => {
        editTransform(id, property, axis, degrees);
      });
    });

    $('objectName').addEventListener('change', () => {
      if (!selected || viewerMode) return;

      checkpoint();

      selected.name = $('objectName').value.trim() || 'Object';

      refreshHierarchy();
    });

    // ==================================================
    // COLORS, GRADIENTS, IMAGE TEXTURES
    // ==================================================

    function applyColor(color) {
      if (!selected || viewerMode) return say('Select an object first.');

      checkpoint();

      const mats = Array.isArray(selected.material)
        ? selected.material
        : selected.material
          ? [selected.material]
          : [];

      if (!mats.length) {
        return say('Select an individual part to change its material.');
      }

      mats.forEach(mat => {
        mat.color.set(color);
        mat.needsUpdate = true;
      });
    }

    $('color').addEventListener('input', e => {
      applyColor(e.target.value);
    });

    document.querySelectorAll('[data-color]').forEach(button => {
      button.onclick = () => {
        $('color').value = button.dataset.color;
        applyColor(button.dataset.color);
      };
    });

    function canvasTexture(draw) {
      const canvas = document.createElement('canvas');

      canvas.width = canvas.height = 512;

      draw(canvas.getContext('2d'), 512);

      const texture = new THREE.CanvasTexture(canvas);

      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;

      return texture;
    }

    $('gradientBtn').onclick = () => {
      const a = $('gradA').value;
      const b = $('gradB').value;
      const direction = $('gradientDirection').value;

      const texture = canvasTexture((ctx, size) => {
        const gradient = direction === 'vertical'
          ? ctx.createLinearGradient(0, 0, 0, size)
          : direction === 'diagonal'
            ? ctx.createLinearGradient(0, 0, size, size)
            : ctx.createLinearGradient(0, 0, size, 0);

        gradient.addColorStop(0, a);
        gradient.addColorStop(1, b);

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
      });

      applyTexture(texture);
    };

    function applyTexture(texture) {
      if (!selected || viewerMode) {
        texture.dispose();
        return say('Select an object first.');
      }

      checkpoint();

      const mats = Array.isArray(selected.material)
        ? selected.material
        : [selected.material];

      mats.forEach(mat => {
        mat.map = texture;
        mat.color.set('#ffffff');
        mat.needsUpdate = true;
      });

      say('Texture applied.');
    }

    $('textureFile').addEventListener('change', event => {
      const file = event.target.files[0];

      if (!file) return;

      const reader = new FileReader();

      reader.onload = () => {
        new THREE.TextureLoader().load(reader.result, texture => {
          texture.colorSpace = THREE.SRGBColorSpace;
          applyTexture(texture);
        });
      };

      reader.readAsDataURL(file);
      event.target.value = '';
    });

    // ==================================================
    // MATERIAL, OPACITY, LIGHTS
    // ==================================================

    $('metalness').addEventListener('input', e => {
      $('metalValue').textContent = Number(e.target.value).toFixed(2);

      if (!selected || viewerMode) return;

      const mats = Array.isArray(selected.material)
        ? selected.material
        : [selected.material];

      mats.forEach(m => {
        m.metalness = Number(e.target.value);
      });
    });

    $('roughness').addEventListener('input', e => {
      $('roughValue').textContent = Number(e.target.value).toFixed(2);

      if (!selected || viewerMode) return;

      const mats = Array.isArray(selected.material)
        ? selected.material
        : [selected.material];

      mats.forEach(m => {
        m.roughness = Number(e.target.value);
      });
    });

    $('opacity').addEventListener('input', e => {
      globalOpacity = Number(e.target.value);

      $('opacityValue').textContent =
        Math.round(globalOpacity * 100) + '%';

      updateOpacity();
    });

    $('fade').addEventListener('input', e => {
      otherOpacity = Number(e.target.value);

      $('fadeValue').textContent =
        Math.round(otherOpacity * 100) + '%';

      updateOpacity();
    });

    $('lightPower').addEventListener('input', e => {
      keyLight.intensity = Number(e.target.value);
      $('lightValue').textContent = Number(e.target.value).toFixed(1);
    });

    $('ambientPower').addEventListener('input', e => {
      $('ambientValue').textContent = Number(e.target.value).toFixed(1);
    });

    $('shadowBtn').onclick = () => {
      shadowsEnabled = !shadowsEnabled;

      renderer.shadowMap.enabled = shadowsEnabled;
      keyLight.castShadow = shadowsEnabled;
      ground.visible = shadowsEnabled;

      $('shadowBtn').textContent =
        shadowsEnabled ? 'Shadows on' : 'Shadows off';

      $('shadowBtn').classList.toggle('active', shadowsEnabled);
    };

    $('lightsBtn').onclick = () => {
      studioLights = !studioLights;

      fillLight.visible = rimLight.visible = studioLights;

      $('lightsBtn').textContent =
        studioLights ? 'Studio lights' : 'Studio lights off';

      $('lightsBtn').classList.toggle('active', studioLights);
    };

    $('gridBtn').onclick = () => {
      grid.visible = !grid.visible;
      $('gridBtn').classList.toggle('active', grid.visible);
    };

    $('wireBtn').onclick = () => {
      wireframe = !wireframe;

      allParts().forEach(object => {
        const mats = Array.isArray(object.material)
          ? object.material
          : [object.material];

        mats.forEach(m => {
          m.wireframe = wireframe;
        });
      });

      $('wireBtn').classList.toggle('active', wireframe);
    };

    // ==================================================
    // STARTER DESIGNS
    // ==================================================

    function makeBox(color, name, pos, scale, radius = 0.05) {
      const geo = radius
        ? new RoundedBoxGeometry(1, 1, 1, 3, radius)
        : new THREE.BoxGeometry(1, 1, 1);

      const mesh = createPart(
        geo,
        name,
        radius ? 'roundedBox' : 'box',
        color
      );

      mesh.position.set(...pos);
      mesh.scale.set(...scale);

      return mesh;
    }

    function addTemplate(type) {
      if (viewerMode) return say('Exit Viewer mode first.');

      checkpoint();

      const group = new THREE.Group();

      group.name = ({
        shoe: 'Sneaker',
        bag: 'Handbag',
        shirt: 'T-shirt',
        chair: 'Chair'
      })[type];

      const add = mesh => {
        mesh.userData.formoraPart = true;
        group.add(mesh);
        return mesh;
      };

      if (type === 'shoe') {
        add(makeBox('#30313a', 'Sole', [0, .2, 0], [2.4, .3, 1], .1));
        add(makeBox('#8b78ff', 'Upper', [-.1, .52, 0], [1.7, .55, .88], .13));
        add(makeBox('#e8e8f0', 'Toe cap', [.78, .48, 0], [.6, .35, .9], .12));

        for (let i = 0; i < 4; i++) {
          add(makeBox(
            '#f5f3ff',
            `Lace ${i + 1}`,
            [.15 + i * .14, .83, 0],
            [.08, .035, .57],
            .01
          ));
        }
      } else if (type === 'bag') {
        add(makeBox('#8b78ff', 'Bag body', [0, .65, 0], [1.5, 1.05, .65], .13));
        add(makeBox('#e9c68f', 'Clasp', [0, .7, .35], [.2, .2, .06], .02));

        const handle = createPart(
          new THREE.TorusGeometry(.48, .075, 10, 32, Math.PI),
          'Handle',
          'torus',
          '#e9c68f'
        );

        handle.position.set(0, 1.35, 0);
        handle.rotation.z = Math.PI;

        add(handle);
      } else if (type === 'shirt') {
        add(makeBox('#8b78ff', 'Shirt body', [0, .85, 0], [1.35, 1.5, .35], .06));
        add(makeBox('#8b78ff', 'Left sleeve', [-.92, 1.25, 0], [.55, .52, .34], .06));
        add(makeBox('#8b78ff', 'Right sleeve', [.92, 1.25, 0], [.55, .52, .34], .06));
        add(makeBox('#e4dfff', 'Front logo', [0, 1, .19], [.38, .32, .025], .01));
      } else if (type === 'chair') {
        add(makeBox('#9a6847', 'Seat', [0, .8, 0], [1.2, .18, 1.1], .04));
        add(makeBox('#9a6847', 'Backrest', [0, 1.45, -.47], [1.2, 1.2, .16], .04));

        for (const x of [-.48, .48]) {
          for (const z of [-.42, .42]) {
            add(makeBox(
              '#765037',
              'Chair leg',
              [x, .38, z],
              [.13, .75, .13],
              .015
            ));
          }
        }
      }

      root.add(group);

      const first = allParts().find(part => group.getObjectById(part.id));

      select(first || null);
      focus(group);

      say(`${group.name} added.`);
    }

    // ==================================================
    // SAVE, EXPORT, SCREENSHOT, IMPORT
    // ==================================================

    function download(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download = filename;
      a.click();

      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    $('saveBtn').onclick = () => {
      download(
        new Blob([JSON.stringify(root.toJSON())], {
          type: 'application/json'
        }),
        'formora-project.json'
      );

      say('Project saved.');
    };

    $('exportBtn').onclick = () => {
      new GLTFExporter().parse(
        root,
        result => {
          download(
            new Blob([result], { type: 'model/gltf-binary' }),
            'formora-design.glb'
          );

          say('GLB exported.');
        },
        error => {
          console.error(error);
          say('Export failed. Check the console.');
        },
        { binary: true }
      );
    };

    $('screenshotBtn').onclick = () => {
      renderer.render(scene, camera);

      renderer.domElement.toBlob(blob => {
        if (blob) download(blob, 'formora-screenshot.png');
      }, 'image/png');
    };

    const importInput = document.createElement('input');

    importInput.type = 'file';
    importInput.accept = '.glb,.gltf,.obj';
    importInput.hidden = true;

    document.body.appendChild(importInput);

    const importBtn = document.createElement('button');

    importBtn.textContent = 'Import 3D model';
    importBtn.style.cssText = 'width:100%;margin-top:8px';

    document.querySelector('.left').appendChild(importBtn);

    importBtn.onclick = () => importInput.click();

    importInput.addEventListener('change', () => {
      const file = importInput.files[0];

      if (!file) return;

      const url = URL.createObjectURL(file);
      const ext = file.name.split('.').pop().toLowerCase();

      const loaded = object => {
        checkpoint();

        object.traverse(child => {
          if (child.isMesh) {
            child.userData.formoraPart = true;
            child.userData.shape = 'custom';

            child.castShadow = true;
            child.receiveShadow = true;

            if (!child.material) {
              child.material = createMaterial();
            }
          }
        });

        object.name = file.name.replace(/\.[^.]+$/, '');

        root.add(object);

        const first = allParts().find(p => object.getObjectById(p.id));

        select(first || null);
        focus(object);

        URL.revokeObjectURL(url);

        say('Model imported.');
      };

      const failed = error => {
        console.error(error);

        URL.revokeObjectURL(url);

        say('Could not import this model.');
      };

      if (ext === 'obj') {
        new OBJLoader().load(url, loaded, undefined, failed);
      } else {
        new GLTFLoader().load(
          url,
          gltf => loaded(gltf.scene),
          undefined,
          failed
        );
      }

      importInput.value = '';
    });

    // ==================================================
    // UI WIRING AND SHORTCUTS
    // ==================================================

    $('objectMode').onclick = () => setMode('object');
    $('vertexMode').onclick = () => setMode('vertex');

    $('moveBtn').onclick = () => setTransformMode('translate');
    $('rotateBtn').onclick = () => setTransformMode('rotate');
    $('scaleBtn').onclick = () => setTransformMode('scale');

    $('duplicateBtn').onclick = duplicateSelected;
    $('deleteBtn').onclick = deleteSelected;
    $('clearBtn').onclick = clearScene;

    $('focusBtn').onclick = () => {
      selected
        ? focus(selected)
        : say('Select an object first.');
    };

    document.querySelectorAll('[data-shape]').forEach(button => {
      button.onclick = () => addShape(button.dataset.shape);
    });

    document.querySelectorAll('[data-template]').forEach(button => {
      button.onclick = () => addTemplate(button.dataset.template);
    });

    addHistoryButtons();
    createVertexPanel();
    updateHistoryButtons();
    refreshHierarchy();

    window.addEventListener('keydown', event => {
      const tag = document.activeElement?.tagName;

      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;

      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
        return;
      }

      if (
        (event.ctrlKey && event.key.toLowerCase() === 'y') ||
        (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')
      ) {
        event.preventDefault();
        redo();
        return;
      }

      if (event.ctrlKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
      }

      if (event.ctrlKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        $('saveBtn').click();
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteSelected();
      }

      if (event.key.toLowerCase() === 'w') {
        setTransformMode('translate');
      }

      if (event.key.toLowerCase() === 'e') {
        setTransformMode('rotate');
      }

      if (event.key.toLowerCase() === 'r') {
        setTransformMode('scale');
      }

      if (event.key === 'Escape' && viewerMode) {
        toggleViewer();
      }
    });

    // ==================================================
    // RENDER LOOP
    // ==================================================

    function animate() {
      requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
    }

    say('FORMORA Studio ready. Add a shape to begin.');
    animate();

  } catch (error) {
    console.error('FORMORA startup error:', error);

    $('error').hidden = false;

    $('error').textContent =
      'FORMORA could not start: ' + (error.message || error) +
      '. Open the site with Live Server and check your internet connection.';

    $('status').textContent =
      'Startup error — see the message in the workspace.';
  }
}

startFORMORA();
// Blender-style mesh vertex editing foundation.
// This edits the actual geometry, not just the visual handles.

function moveMeshVertex(mesh, vertexIndex, newLocalPosition) {
  if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) {
    return false;
  }

  const geometry = mesh.geometry;
  const positions = geometry.attributes.position;

  if (vertexIndex < 0 || vertexIndex >= positions.count) {
    return false;
  }

  // Save the geometry before changing it so undo can restore it.
  if (!geometry.userData) geometry.userData = {};

  positions.setXYZ(
    vertexIndex,
    newLocalPosition.x,
    newLocalPosition.y,
    newLocalPosition.z
  );

  positions.needsUpdate = true;

  // Recalculate lighting and the mesh's visible surface.
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return true;
}