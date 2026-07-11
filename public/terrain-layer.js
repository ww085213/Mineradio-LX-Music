/**
 * 3D terrain layer — adapted from sonic-topography (Non-Commercial Learning License)
 * https://github.com/yin-yizhen/sonic-topography
 */
(function (global) {
  'use strict';

  var G = global.TerrainGroundEq;
  var MAX_RIPPLES = 10;
  var MAX_METEORS = 20;
  var MAX_PARTICLES = 200;

  var DEFAULT_INK_THEME = {
    uBaseColor1: [0.01, 0.02, 0.04],
    uBaseColor2: [0.03, 0.05, 0.09],
    uFogColor: [0.01, 0.02, 0.04],
    uCoolCore: [0.0, 0.3, 1.0],
    uCoolEdge: [0.6, 0.2, 1.0],
    uWarmCore: [1.0, 0.2, 0.1],
    uWarmEdge: [1.0, 0.6, 0.0],
    uRippleColor: [0.2, 0.9, 1.0],
    uGlowIntensity: 1.0
  };

  var INK_THEME = cloneTheme(DEFAULT_INK_THEME);

  function clamp01(v, fallback) {
    var n = Number(v);
    if (!Number.isFinite(n)) n = fallback || 0;
    return Math.max(0, Math.min(1, n));
  }

  function normalizeColorArr(arr, fallback) {
    var src = Array.isArray(arr) ? arr : fallback;
    return [
      clamp01(src && src[0], fallback[0]),
      clamp01(src && src[1], fallback[1]),
      clamp01(src && src[2], fallback[2])
    ];
  }

  function cloneTheme(src) {
    src = src || DEFAULT_INK_THEME;
    return {
      uBaseColor1: normalizeColorArr(src.uBaseColor1, DEFAULT_INK_THEME.uBaseColor1),
      uBaseColor2: normalizeColorArr(src.uBaseColor2, DEFAULT_INK_THEME.uBaseColor2),
      uFogColor: normalizeColorArr(src.uFogColor, DEFAULT_INK_THEME.uFogColor),
      uCoolCore: normalizeColorArr(src.uCoolCore, DEFAULT_INK_THEME.uCoolCore),
      uCoolEdge: normalizeColorArr(src.uCoolEdge, DEFAULT_INK_THEME.uCoolEdge),
      uWarmCore: normalizeColorArr(src.uWarmCore, DEFAULT_INK_THEME.uWarmCore),
      uWarmEdge: normalizeColorArr(src.uWarmEdge, DEFAULT_INK_THEME.uWarmEdge),
      uRippleColor: normalizeColorArr(src.uRippleColor, DEFAULT_INK_THEME.uRippleColor),
      uGlowIntensity: Math.max(0, Math.min(2.5, Number.isFinite(Number(src.uGlowIntensity)) ? Number(src.uGlowIntensity) : DEFAULT_INK_THEME.uGlowIntensity))
    };
  }

  function applyThemeUniforms(uniforms, theme) {
    if (!uniforms) return;
    theme = cloneTheme(theme);
    ['uBaseColor1', 'uBaseColor2', 'uFogColor', 'uCoolCore', 'uCoolEdge', 'uWarmCore', 'uWarmEdge', 'uRippleColor'].forEach(function (key) {
      if (uniforms[key] && uniforms[key].value) {
        uniforms[key].value.copy(colorFromArr(theme[key]));
      }
    });
    if (uniforms.uGlowIntensity) uniforms.uGlowIntensity.value = theme.uGlowIntensity;
  }

  function rippleSlot(n) {
    return [
      'if(uRipMeta' + n + '.x>0.5){',
      'vec2 rpos' + n + '=uRip' + n + '.xy;',
      'float rtime' + n + '=uRip' + n + '.z; float rstrength' + n + '=uRip' + n + '.w;',
      'float rtype' + n + '=uRipMeta' + n + '.y;',
      'float dist' + n + '=length(pos2D-rpos' + n + ');',
      'float timeSince' + n + '=uTime-rtime' + n + ';',
      'float curSpeed' + n + '=15.0; float curWidth' + n + '=3.0; float curFadeDist' + n + '=15.0; float elevationScale' + n + '=4.0;',
      'if(rtype' + n + '>0.5){curSpeed' + n + '=20.0;curWidth' + n + '=1.0;curFadeDist' + n + '=8.0;elevationScale' + n + '=1.0;}',
      'float waveRadius' + n + '=timeSince' + n + '*curSpeed' + n + ';',
      'float d' + n + '=dist' + n + '-waveRadius' + n + ';',
      'float rippleWave' + n + '=exp(-d' + n + '*d' + n + '/curWidth' + n + ');',
      'float fade' + n + '=exp(-waveRadius' + n + '/curFadeDist' + n + ');',
      'float rPulse' + n + '=rippleWave' + n + '*fade' + n + '*rstrength' + n + ';',
      'rippleElevation+=rPulse' + n + '*elevationScale' + n + ';',
      'if(rtype' + n + '>0.5){rippleIntensityWhite+=rPulse' + n + ';}else{rippleIntensityNormal+=rPulse' + n + ';}',
      '}'
    ].join('\n');
  }

  var RIPPLE_UNROLL = 'float rippleElevation=0.0; float rippleIntensityNormal=0.0; float rippleIntensityWhite=0.0;\n' +
    rippleSlot(0) + rippleSlot(1) + rippleSlot(2) + rippleSlot(3) + rippleSlot(4) +
    rippleSlot(5) + rippleSlot(6) + rippleSlot(7) + rippleSlot(8) + rippleSlot(9);

  var RIPPLE_UNIFORMS_GLSL = (function () {
    var lines = [];
    for (var i = 0; i < MAX_RIPPLES; i++) {
      lines.push('uniform vec4 uRip' + i + '; uniform vec4 uRipMeta' + i + ';');
    }
    return lines.join(' ');
  })();

  var TERRAIN_VERT = [
    'precision highp float;',
    'attribute vec2 aCellXZ;',
    'uniform float uTime;',
    'uniform float uSubBass; uniform float uBass; uniform float uLowMid; uniform float uMid; uniform float uHighMid;',
    'uniform float uSmoothness; uniform float uDensity; uniform float uEnergy; uniform float uAmplitude;',
    RIPPLE_UNIFORMS_GLSL,
    'varying vec2 vUv; varying float vElevation; varying float vDistance; varying vec2 vRippleAnim;',
    'varying vec3 vNormal; varying float vRelativeY; varying vec2 vInstancePos;',
    'vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec2 mod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}',
    'vec3 permute(vec3 x){return mod289(((x*34.0)+1.0)*x);}',
    'float snoise(vec2 v){',
    'const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);',
    'vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);',
    'vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);',
    'vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod289(i);',
    'vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));',
    'vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);',
    'm=m*m; m=m*m;',
    'vec3 x=2.0*fract(p*C.www)-1.0; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5);',
    'vec3 a0=x-ox; m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);',
    'vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;',
    'return 130.0*dot(m,g);',
    '}',
    'float random(vec2 st){return fract(sin(dot(st,vec2(12.9898,78.233)))*43758.5453123);}',
    'void main(){',
    'vUv=uv; vNormal=normal;',
    'vec2 pos2D=aCellXZ; vInstancePos=pos2D;',
    'float centerDist=length(pos2D); vDistance=centerDist;',
    'float rnd=random(pos2D);',
    'vec2 movingPos=pos2D*0.05+vec2(uTime*0.1,uTime*0.05);',
    'float baseNoise=(snoise(movingPos)+1.0)*0.5;',
    'float wave=sin(pos2D.x*0.15+pos2D.y*0.1-uTime*0.6)*0.5+0.5;',
    'float globalFalloff=smoothstep(60.0,30.0,centerDist);',
    'float idleElevation=mix(baseNoise,wave,uSmoothness*0.5+0.2)*0.8*globalFalloff;',
    'float subRegion=smoothstep(25.0,0.0,centerDist);',
    'float subLift=uSubBass*subRegion*5.0;',
    'float bassNoise=snoise(pos2D*0.1-vec2(0.0,uTime*0.2));',
    'float bassRegion=smoothstep(35.0,5.0,centerDist+bassNoise*5.0);',
    'float bassLift=uBass*bassRegion*(smoothstep(0.0,1.0,rnd+uDensity*0.5))*4.0;',
    'float lowMidNoise=snoise(pos2D*0.05+vec2(uTime*0.1,0.0));',
    'float lowMidLift=uLowMid*(lowMidNoise*0.5+0.5)*2.5;',
    'float riverFlow=sin(pos2D.x*0.2+pos2D.y*0.2+snoise(pos2D*0.1)*2.0-uTime*2.0);',
    'float midLift=uMid*max(0.0,riverFlow)*3.0;',
    'float highMidRegion=smoothstep(10.0,45.0,centerDist);',
    'float highMidLift=0.0;',
    'if(fract(rnd*13.3)>0.8){highMidLift=uHighMid*highMidRegion*fract(rnd*7.7)*2.5;}',
    'float audioElevation=subLift+bassLift+lowMidLift+midLift+highMidLift;',
    'if(rnd>0.99){audioElevation+=uEnergy*5.0;}',
    'audioElevation*=globalFalloff;',
    'audioElevation=max(0.0,audioElevation-0.2);',
    'audioElevation*=uAmplitude;',
    'float elevation=idleElevation+audioElevation;',
    RIPPLE_UNROLL,
    'elevation+=rippleElevation;',
    'vRippleAnim=vec2(clamp(rippleIntensityNormal,0.0,1.0),clamp(rippleIntensityWhite,0.0,1.0));',
    'vElevation=elevation;',
    'float yPos=position.y+0.5; vRelativeY=yPos;',
    'float totalHeight=1.0+elevation;',
    'vec3 pos=position; pos.y=-0.5+yPos*totalHeight;',
    'vec3 worldPos=vec3(aCellXZ.x+pos.x,pos.y,aCellXZ.y+pos.z);',
    'gl_Position=projectionMatrix*modelViewMatrix*vec4(worldPos,1.0);',
    '}'
  ].join('\n');

  var TERRAIN_FRAG = [
    'precision highp float;',
    'uniform float uTime; uniform float uPresence; uniform float uBrilliance; uniform float uAir;',
    'uniform float uWarmth; uniform float uBrightness; uniform float uSharpness;',
    'uniform vec3 uBaseColor1; uniform vec3 uBaseColor2; uniform vec3 uFogColor;',
    'uniform vec3 uCoolCore; uniform vec3 uCoolEdge; uniform vec3 uWarmCore; uniform vec3 uWarmEdge;',
    'uniform vec3 uRippleColor; uniform float uGlowIntensity;',
    'varying vec2 vUv; varying float vElevation; varying float vDistance; varying vec2 vRippleAnim;',
    'varying vec3 vNormal; varying float vRelativeY; varying vec2 vInstancePos;',
    'float random(vec2 st){return fract(sin(dot(st,vec2(12.9898,78.233)))*43758.5453123);}',
    'void main(){',
    'float isTop=step(0.5,vNormal.y); float distFromTop=1.0-vRelativeY;',
    'float rnd=random(vInstancePos); float centerDist=length(vInstancePos);',
    'float normElevation=clamp(vElevation/8.0,0.0,1.0);',
    'vec3 cBase1=uBaseColor1; vec3 cBase2=uBaseColor2;',
    'float warmBlend=smoothstep(0.0,1.0,uWarmth*1.5+(0.5-centerDist/80.0));',
    'vec3 zoneCore=mix(uCoolCore,uWarmCore,warmBlend);',
    'vec3 zoneEdge=mix(uCoolEdge,uWarmEdge,warmBlend);',
    'vec3 targetGlow=mix(zoneCore,zoneEdge,fract(rnd*11.0));',
    'float distFade=1.0-smoothstep(40.0,75.0,centerDist);',
    'vec3 brightCool=mix(uCoolCore,vec3(1.0),0.24);',
    'targetGlow=mix(targetGlow,brightCool,uBrightness*0.6);',
    'vec3 currentGlow=mix(cBase2,targetGlow,normElevation)*uGlowIntensity*distFade;',
    'currentGlow=mix(currentGlow,uRippleColor,vRippleAnim.x);',
    'currentGlow=mix(currentGlow,vec3(1.0),vRippleAnim.y);',
    'vec3 bodyColor=mix(cBase1,cBase2,vRelativeY*distFade);',
    'vec3 finalColor=bodyColor;',
    'float topIntensity=smoothstep(0.0,0.4,normElevation);',
    'float twinkleDistFalloff=smoothstep(60.0,30.0,centerDist);',
    'float twinkleMultiplier=mix(twinkleDistFalloff,1.0,smoothstep(0.01,0.1,normElevation));',
    'if(isTop>0.5){',
    'if(fract(rnd*31.0)>0.95&&normElevation<0.1){topIntensity+=uAir*2.0*twinkleMultiplier;}',
    'finalColor=mix(cBase2,currentGlow,topIntensity);',
    'float edgeX=smoothstep(0.05,0.01,vUv.x)+smoothstep(0.95,0.99,vUv.x);',
    'float edgeY=smoothstep(0.05,0.01,vUv.y)+smoothstep(0.95,0.99,vUv.y);',
    'float edge=min(edgeX+edgeY,1.0);',
    'finalColor+=currentGlow*edge*0.8*(topIntensity+0.3);',
    'float flashChance=smoothstep(0.3,1.0,uPresence);',
    'if(fract(rnd*53.0)>0.98-flashChance*0.1){',
    'float flashSync=sin(uTime*40.0+rnd*100.0)*0.5+0.5;',
    'finalColor+=mix(vec3(1.0),vec3(0.5,1.0,1.0),rnd)*flashSync*uPresence*(1.0+uSharpness*2.0)*twinkleMultiplier;',
    '}',
    'if(edge>0.5&&fract(rnd*89.0+uTime*2.0)>0.98){finalColor+=vec3(1.0)*uBrilliance*3.0*twinkleMultiplier;}',
    '}else{',
    'float verticalFalloff=mix(1.0,3.0,uSharpness);',
    'float sideGlow=smoothstep(0.5/verticalFalloff,0.0,distFromTop)*normElevation;',
    'if(normElevation<0.02)sideGlow=0.0;',
    'finalColor=mix(bodyColor,currentGlow,sideGlow*1.5);',
    'float rimGlow=smoothstep(0.03,0.0,distFromTop)*normElevation;',
    'finalColor+=currentGlow*rimGlow;',
    '}',
    'finalColor+=uRippleColor*vRippleAnim.x*0.6;',
    'finalColor+=vec3(1.0)*vRippleAnim.y*1.2;',
    'float aerialFog=smoothstep(30.0,65.0,vDistance);',
    'vec3 atmosphericColor=mix(cBase1,cBase2,0.4);',
    'finalColor=mix(finalColor,atmosphericColor,aerialFog*0.35);',
    'float alphaFade=1.0-smoothstep(55.0,78.0,vDistance);',
    'finalColor=mix(finalColor,uFogColor,(1.0-alphaFade)*0.45);',
    'gl_FragColor=vec4(finalColor,alphaFade);',
    '}'
  ].join('\n');

  var FLOAT_VERT = [
    'precision highp float;',
    '#ifdef USE_INSTANCING',
    'attribute mat4 instanceMatrix;',
    '#endif',
    'uniform float uTime; uniform float uPulse;',
    'varying vec2 vUv; varying float vElevation; varying float vDistance; varying vec2 vRippleAnim;',
    'varying vec3 vNormal; varying float vRelativeY; varying vec2 vInstancePos;',
    'void main(){',
    'vUv=uv; vNormal=normal;',
    '#ifdef USE_INSTANCING',
    'vec4 instancePos=instanceMatrix*vec4(0.0,0.0,0.0,1.0);',
    '#else',
    'vec4 instancePos=vec4(0.0,0.5,0.0,1.0);',
    '#endif',
    'vec2 pos2D=instancePos.xz; vInstancePos=pos2D; vDistance=length(pos2D);',
    'vRippleAnim=vec2(uPulse*0.8,uPulse*0.3); vElevation=uPulse*20.0; vRelativeY=position.y+0.5;',
    '#ifdef USE_INSTANCING',
    'vec4 worldPosition=modelMatrix*instanceMatrix*vec4(position,1.0);',
    '#else',
    'vec4 worldPosition=modelMatrix*vec4(position,1.0);',
    '#endif',
    'gl_Position=projectionMatrix*viewMatrix*worldPosition;',
    '}'
  ].join('\n');

  var FLOAT_FRAG = TERRAIN_FRAG;

  function colorFromArr(arr) {
    return new THREE.Color(arr[0], arr[1], arr[2]);
  }

  function buildRippleUniforms() {
    var uniforms = {};
    for (var i = 0; i < MAX_RIPPLES; i++) {
      uniforms['uRip' + i] = { value: new THREE.Vector4() };
      uniforms['uRipMeta' + i] = { value: new THREE.Vector4() };
    }
    return uniforms;
  }

  function TerrainLayer(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'terrainLayer';
    this.group.visible = false;
    this.viewScale = 0.085;
    this.group.scale.setScalar(this.viewScale);
    this.platter = new THREE.Group();
    this.platter.name = 'terrainPlatter';
    this.group.add(this.platter);
    scene.add(this.group);
    this.mesh = null;
    this.material = null;
    this.floatMesh = null;
    this.floatMat = null;
    this.floatBlocks = [];
    this.floatPulse = 0;
    this.floatBlockKey = '';
    this.meteorMesh = null;
    this.particleMesh = null;
    this.meteorMat = null;
    this.particleMat = null;
    this.gridKey = '';
    this.elapsed = 0;
    this.rotationSpeed = 0.15;
    this.ripples = [];
    this.rippleIndex = 0;
    this.meteors = [];
    this.meteorIndex = 0;
    this.meteorLastSpawn = -Infinity;
    this.particles = [];
    this.particleIndex = 0;
    this.smoothed = { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0, air: 0 };
    this.dummyMatrix = new THREE.Matrix4();
    this.dummyPos = new THREE.Vector3();
    this.dummyQuat = new THREE.Quaternion();
    this.dummyEuler = new THREE.Euler();
    this.dummyScale = new THREE.Vector3(1, 1, 1);
    this.theme = cloneTheme(INK_THEME);
    for (var i = 0; i < MAX_RIPPLES; i++) {
      this.ripples.push({ posX: 0, posZ: 0, time: -100, strength: 0, isActive: 0, rippleType: 0 });
    }
    for (var m = 0; m < MAX_METEORS; m++) {
      this.meteors.push({ active: false, x: 0, y: -1000, z: 0, speed: 0, strength: 0 });
    }
    for (var p = 0; p < MAX_PARTICLES; p++) {
      this.particles.push({ active: false, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, scale: 1 });
    }
  }

  TerrainLayer.prototype.disposeMesh = function () {
    if (this.mesh) {
      this.platter.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (this.mesh.material) this.mesh.material.dispose();
      this.mesh = null;
      this.material = null;
    }
  };

  TerrainLayer.prototype.disposeFloatMesh = function () {
    if (this.floatMesh) {
      this.platter.remove(this.floatMesh);
      this.floatMesh.geometry.dispose();
      if (this.floatMat) this.floatMat.dispose();
      this.floatMesh = null;
      this.floatMat = null;
      this.floatBlocks = [];
      this.floatBlockKey = '';
    }
  };

  TerrainLayer.prototype.buildFloatBlocks = function (count) {
    var blocks = [];
    for (var index = 0; index < count; index++) {
      var ring = index / count;
      var angle = ring * Math.PI * 2 * 5.0 + Math.sin(index * 12.9898) * 0.7;
      var radius = 14 + ((index * 37) % 62);
      var height = 6 + ((index * 17) % 19);
      blocks.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        y: height,
        baseScale: 0.75 + ((index * 11) % 9) * 0.05,
        phase: index * 0.73,
        rotationSpeed: 0.18 + ((index * 7) % 10) * 0.035
      });
    }
    return blocks;
  };

  TerrainLayer.prototype.ensureFloatingBlocks = function (groundEq) {
    var eq = groundEq || G.defaults();
    var enabled = eq.floatingBlocksEnabled !== false;
    var count = eq.floatingBlockCount || 80;
    var key = (enabled ? '1' : '0') + ':' + count;
    if (this.floatMesh && this.floatBlockKey === key) return;
    this.disposeFloatMesh();
    this.floatBlockKey = key;
    if (!enabled) return;
    this.floatBlocks = this.buildFloatBlocks(count);
    var geo = new THREE.BoxGeometry(1, 1, 1);
    this.floatMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPulse: { value: 0 },
        uPresence: { value: 0 }, uBrilliance: { value: 0 }, uAir: { value: 0 },
        uWarmth: { value: 0 }, uBrightness: { value: 0 }, uSharpness: { value: 0 },
        uBaseColor1: { value: colorFromArr(this.theme.uBaseColor1) },
        uBaseColor2: { value: colorFromArr(this.theme.uBaseColor2) },
        uFogColor: { value: colorFromArr(this.theme.uFogColor) },
        uCoolCore: { value: colorFromArr(this.theme.uCoolCore) },
        uCoolEdge: { value: colorFromArr(this.theme.uCoolEdge) },
        uWarmCore: { value: colorFromArr(this.theme.uWarmCore) },
        uWarmEdge: { value: colorFromArr(this.theme.uWarmEdge) },
        uRippleColor: { value: colorFromArr(this.theme.uRippleColor) },
        uGlowIntensity: { value: this.theme.uGlowIntensity }
      },
      vertexShader: FLOAT_VERT,
      fragmentShader: FLOAT_FRAG,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide
    });
    this.floatMesh = new THREE.InstancedMesh(geo, this.floatMat, this.floatBlocks.length);
    this.floatMesh.frustumCulled = false;
    this.floatMesh.renderOrder = 3;
    this.platter.add(this.floatMesh);
  };

  TerrainLayer.prototype.ensureGrid = function (groundEq, ecoCap) {
    var grid = G.deriveGridSettings(groundEq.terrainDensity, ecoCap);
    var key = grid.gridSize + ':' + grid.spacing;
    if (this.mesh && this.gridKey === key) return grid;
    this.disposeMesh();
    this.gridKey = key;
    var geo = new THREE.BoxGeometry(grid.boxWidth, 1, grid.boxWidth);
    var cellXZ = new Float32Array(grid.instanceCount * 2);
    var offset = (grid.gridSize * grid.spacing) / 2;
    var ci = 0;
    for (var gx = 0; gx < grid.gridSize; gx++) {
      for (var gz = 0; gz < grid.gridSize; gz++) {
        cellXZ[ci++] = gx * grid.spacing - offset;
        cellXZ[ci++] = gz * grid.spacing - offset;
      }
    }
    geo.setAttribute('aCellXZ', new THREE.InstancedBufferAttribute(cellXZ, 2));

    var uniforms = buildRippleUniforms();
    uniforms.uTime = { value: 0 };
    uniforms.uSubBass = { value: 0 };
    uniforms.uBass = { value: 0 };
    uniforms.uLowMid = { value: 0 };
    uniforms.uMid = { value: 0 };
    uniforms.uHighMid = { value: 0 };
    uniforms.uSmoothness = { value: 0.5 };
    uniforms.uDensity = { value: 0.5 };
    uniforms.uEnergy = { value: 0 };
    uniforms.uAmplitude = { value: 1 };
    uniforms.uBaseColor1 = { value: colorFromArr(this.theme.uBaseColor1) };
    uniforms.uBaseColor2 = { value: colorFromArr(this.theme.uBaseColor2) };
    uniforms.uFogColor = { value: colorFromArr(this.theme.uFogColor) };
    uniforms.uCoolCore = { value: colorFromArr(this.theme.uCoolCore) };
    uniforms.uCoolEdge = { value: colorFromArr(this.theme.uCoolEdge) };
    uniforms.uWarmCore = { value: colorFromArr(this.theme.uWarmCore) };
    uniforms.uWarmEdge = { value: colorFromArr(this.theme.uWarmEdge) };
    uniforms.uRippleColor = { value: colorFromArr(this.theme.uRippleColor) };
    uniforms.uGlowIntensity = { value: this.theme.uGlowIntensity };
    uniforms.uPresence = { value: 0 };
    uniforms.uBrilliance = { value: 0 };
    uniforms.uAir = { value: 0 };
    uniforms.uWarmth = { value: 0 };
    uniforms.uBrightness = { value: 0 };
    uniforms.uSharpness = { value: 0 };

    this.material = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, grid.instanceCount);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    var identity = new THREE.Matrix4();
    for (var mi = 0; mi < grid.instanceCount; mi++) {
      this.mesh.setMatrixAt(mi, identity);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.platter.add(this.mesh);
    return grid;
  };

  TerrainLayer.prototype.ensureMeteorLayer = function () {
    if (this.meteorMesh) return;
    var mGeo = new THREE.BoxGeometry(0.4, 1.2, 0.4);
    this.meteorMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    this.meteorMesh = new THREE.InstancedMesh(mGeo, this.meteorMat, MAX_METEORS);
    this.meteorMesh.frustumCulled = false;
    this.meteorMesh.renderOrder = 4;
    this.platter.add(this.meteorMesh);
    var pGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    this.particleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
    this.particleMesh = new THREE.InstancedMesh(pGeo, this.particleMat, MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.renderOrder = 4;
    this.platter.add(this.particleMesh);
  };

  TerrainLayer.prototype.addRipple = function (x, z, strength, isWhite) {
    var idx = this.rippleIndex;
    var r = this.ripples[idx];
    r.posX = x;
    r.posZ = z;
    r.time = this.elapsed;
    r.strength = strength;
    r.isActive = 1;
    r.rippleType = isWhite ? 1 : 0;
    this.rippleIndex = (idx + 1) % MAX_RIPPLES;
  };

  TerrainLayer.prototype.addMeteor = function (strength) {
    var cooldown = 241 / 60;
    if (this.elapsed - this.meteorLastSpawn < cooldown) return;
    this.meteorLastSpawn = this.elapsed;
    var idx = this.meteorIndex;
    var m = this.meteors[idx];
    var angle = Math.random() * Math.PI * 2;
    var dist = Math.random() * 25;
    m.active = true;
    m.x = Math.cos(angle) * dist;
    m.z = Math.sin(angle) * dist;
    m.y = 30 + Math.random() * 10;
    m.speed = 1.0 + Math.random() * 0.5 + strength * 1.5;
    m.strength = strength;
    this.meteorIndex = (idx + 1) % MAX_METEORS;
  };

  TerrainLayer.prototype.spawnParticle = function (x, y, z, speedMul) {
    var idx = this.particleIndex;
    var p = this.particles[idx];
    p.active = true;
    p.x = x + (Math.random() - 0.5) * 1.5;
    p.y = y + (Math.random() - 0.5) * 1.5;
    p.z = z + (Math.random() - 0.5) * 1.5;
    p.vx = (Math.random() - 0.5) * 2.0;
    p.vy = Math.random() * 2.0 + speedMul * 10.0;
    p.vz = (Math.random() - 0.5) * 2.0;
    p.life = 0;
    p.maxLife = 0.5 + Math.random() * 0.5;
    p.scale = Math.random() * 0.6 + 0.2;
    this.particleIndex = (idx + 1) % MAX_PARTICLES;
  };

  TerrainLayer.prototype.handleTrigger = function (strength, mode, action) {
    if (action === 'Meteor') {
      this.addMeteor(strength);
      return;
    }
    var angle = Math.random() * Math.PI * 2;
    if (action === 'Snare') {
      var sd = 10 + Math.random() * 35;
      this.addRipple(Math.cos(angle) * sd, Math.sin(angle) * sd, Math.min(strength * 3.0, 3.0), true);
      return;
    }
    if (mode === 'Kick') {
      var kd = Math.random() * 20;
      this.addRipple(Math.cos(angle) * kd, Math.sin(angle) * kd, Math.min(strength * 2.0, 3.0), false);
    } else {
      var od = 10 + Math.random() * 25;
      this.addRipple(Math.cos(angle) * od, Math.sin(angle) * od, Math.min(strength * 3.0, 3.0), false);
    }
  };

  TerrainLayer.prototype.syncRippleUniform = function () {
    if (!this.material) return;
    for (var i = 0; i < MAX_RIPPLES; i++) {
      var r = this.ripples[i];
      this.material.uniforms['uRip' + i].value.set(r.posX, r.posZ, r.time, r.strength);
      this.material.uniforms['uRipMeta' + i].value.set(r.isActive, r.rippleType, 0, 0);
    }
  };

  TerrainLayer.prototype.update = function (dt, audioData, groundEq, opts) {
    opts = opts || {};
    var ecoCap = !!opts.ecoCap;
    var trailsEnabled = opts.trailsEnabled !== false;
    var rotationSpeed = Number(opts.rotationSpeed);
    if (!Number.isFinite(rotationSpeed)) rotationSpeed = this.rotationSpeed;
    this.elapsed += dt;
    this.platter.rotation.y += rotationSpeed * dt;
    this.ensureGrid(groundEq, ecoCap);
    this.ensureFloatingBlocks(groundEq);
    this.ensureMeteorLayer();
    if (!this.material || !this.mesh) return;

    var eq = groundEq || G.defaults();
    var bands = eq.bands;
    var enabled = eq.enabledBands || new Array(8).fill(true);
    var motionSpeed = eq.motionSpeed;
    var amplitude = eq.amplitude;
    var data = audioData || {};
    var responseRate = THREE.Math.lerp(2.2, 60, motionSpeed / 100);
    var responseBlend = G.clampBlend(1 - Math.exp(-responseRate * dt));
    var kickLow = G.deriveKickLowBands(data.kickEnvelope || 0, data.subBass || 0, data.bass || 0, bands, enabled);
    var sm = this.smoothed;
    var targets = {
      subBass: kickLow.subBass,
      bass: kickLow.bass,
      lowMid: enabled[2] ? G.applyBandValue(data.lowMid, bands, 'lowMid') : 0,
      mid: enabled[3] ? G.applyBandValue(data.mid, bands, 'mid') : 0,
      highMid: enabled[4] ? G.applyBandValue(data.highMid, bands, 'highMid') : 0,
      presence: enabled[5] ? G.applyBandValue(data.presence, bands, 'presence') : 0,
      brilliance: enabled[6] ? G.applyBandValue(data.brilliance, bands, 'brilliance') : 0,
      air: enabled[7] ? G.applyBandValue(data.air, bands, 'air') : 0
    };
    sm.subBass = THREE.Math.lerp(sm.subBass, targets.subBass, responseBlend);
    sm.bass = THREE.Math.lerp(sm.bass, targets.bass, responseBlend);
    sm.lowMid = THREE.Math.lerp(sm.lowMid, targets.lowMid, responseBlend);
    sm.mid = THREE.Math.lerp(sm.mid, targets.mid, responseBlend);
    sm.highMid = THREE.Math.lerp(sm.highMid, targets.highMid, responseBlend);
    sm.presence = THREE.Math.lerp(sm.presence, targets.presence, responseBlend);
    sm.brilliance = THREE.Math.lerp(sm.brilliance, targets.brilliance, responseBlend);
    sm.air = THREE.Math.lerp(sm.air, targets.air, responseBlend);

    var eqAvg = bands.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, bands.length);
    var eqEnergy = Math.max(0, Math.min(1, (data.energy || 0) * (0.25 + (eqAvg / 50) * 0.75)));
    var ampMul = amplitude <= 50 ? amplitude / 50 : 1 + Math.pow((amplitude - 50) / 50, 2) * 14;

    var u = this.material.uniforms;
    u.uTime.value = this.elapsed;
    u.uSubBass.value = sm.subBass;
    u.uBass.value = sm.bass;
    u.uLowMid.value = sm.lowMid;
    u.uMid.value = sm.mid;
    u.uHighMid.value = sm.highMid;
    u.uPresence.value = sm.presence;
    u.uBrilliance.value = sm.brilliance;
    u.uAir.value = sm.air;
    u.uSmoothness.value = data.smoothness || 0.5;
    u.uDensity.value = data.density || 0.5;
    u.uEnergy.value = eqEnergy;
    u.uAmplitude.value = ampMul;
    var warmSum = sm.subBass + sm.bass + sm.lowMid + sm.mid;
    var brightSum = sm.presence + sm.brilliance + sm.air;
    u.uWarmth.value = Math.max(0, Math.min(1, warmSum / Math.max(0.001, warmSum + brightSum)));
    u.uBrightness.value = Math.max(0, Math.min(1, brightSum / Math.max(0.001, warmSum + brightSum)));
    u.uSharpness.value = data.sharpness || 0;

    this.syncRippleUniform();

    if (this.floatMesh && this.floatMat && this.floatBlocks.length) {
      var floatIntensity = (eq.floatingBlockIntensity != null ? eq.floatingBlockIntensity : 55) / 100;
      var floatMin = THREE.Math.lerp(0.12, 0.75, (eq.floatingBlockMinSize != null ? eq.floatingBlockMinSize : 9) / 100);
      var floatMax = Math.max(floatMin + 0.05, THREE.Math.lerp(0.45, 3.2, (eq.floatingBlockMaxSize != null ? eq.floatingBlockMaxSize : 26) / 100));
      var floatSpeed = THREE.Math.lerp(3.0, 36.0, (eq.floatingBlockSpeed != null ? eq.floatingBlockSpeed : 77) / 100);
      var pulseBlend = G.clampBlend(1 - Math.exp(-floatSpeed * dt));
      var rawPulse = Math.max(0, Math.min(1, data.kickEnvelope || 0));
      this.floatPulse += (rawPulse - this.floatPulse) * pulseBlend;
      var sizeMix = Math.max(0, Math.min(1, this.floatPulse * (0.5 + floatIntensity * 1.7)));
      var pulseScale = THREE.Math.lerp(floatMin, floatMax, sizeMix);
      var fu = this.floatMat.uniforms;
      fu.uTime.value = this.elapsed;
      fu.uPulse.value = sizeMix;
      fu.uPresence.value = u.uPresence.value;
      fu.uBrilliance.value = u.uBrilliance.value;
      fu.uAir.value = u.uAir.value;
      fu.uWarmth.value = u.uWarmth.value;
      fu.uBrightness.value = u.uBrightness.value;
      fu.uSharpness.value = u.uSharpness.value;
      for (var fi = 0; fi < this.floatBlocks.length; fi++) {
        var block = this.floatBlocks[fi];
        var bob = Math.sin(this.elapsed * (0.55 + block.rotationSpeed) + block.phase) * 0.45;
        this.dummyPos.set(block.x, block.y + bob + this.floatPulse * floatIntensity * 1.4, block.z);
        this.dummyEuler.set(
          this.elapsed * block.rotationSpeed + block.phase,
          this.elapsed * block.rotationSpeed * 0.7 + block.phase,
          this.elapsed * block.rotationSpeed * 0.45
        );
        this.dummyQuat.setFromEuler(this.dummyEuler);
        var fScale = block.baseScale * pulseScale;
        this.dummyScale.set(fScale, fScale, fScale);
        this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
        this.floatMesh.setMatrixAt(fi, this.dummyMatrix);
      }
      this.floatMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.meteorMesh) {
      var warm = colorFromArr(this.theme.uWarmCore);
      this.meteorMat.color.lerp(warm.clone().lerp(new THREE.Color(1, 1, 1), 0.7), Math.min(1, dt * 3));
      for (var mi = 0; mi < MAX_METEORS; mi++) {
        var met = this.meteors[mi];
        if (!met.active) {
          this.dummyPos.set(0, -1000, 0);
          this.dummyScale.set(0, 0, 0);
        } else {
          met.y -= met.speed * 60 * dt;
          if (met.y <= 0) {
            met.active = false;
            this.addRipple(met.x, met.z, Math.min(met.strength, 1.2), true);
            if (trailsEnabled) {
              for (var pb = 0; pb < 10; pb++) this.spawnParticle(met.x, 0.5, met.z, met.speed * 1.5);
            }
          }
          this.dummyPos.set(met.x, Math.max(0, met.y), met.z);
          this.dummyScale.set(1.5, 1.5, 1.5);
          if (met.y > 0 && trailsEnabled && Math.random() > 0.3) {
            this.spawnParticle(met.x, met.y, met.z, met.speed * 0.2);
          }
        }
        this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
        this.meteorMesh.setMatrixAt(mi, this.dummyMatrix);
      }
      this.meteorMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.particleMesh && trailsEnabled) {
      this.particleMat.color.copy(this.meteorMat.color);
      for (var pi = 0; pi < MAX_PARTICLES; pi++) {
        var part = this.particles[pi];
        if (!part.active) {
          this.dummyPos.set(0, -1000, 0);
          this.dummyScale.set(0, 0, 0);
        } else {
          part.life += dt;
          if (part.life >= part.maxLife) {
            part.active = false;
            this.dummyScale.set(0, 0, 0);
          } else {
            part.x += part.vx * dt * 10;
            part.y += part.vy * dt * 10;
            part.z += part.vz * dt * 10;
            var sc = part.scale * (1.0 - part.life / part.maxLife);
            this.dummyPos.set(part.x, part.y, part.z);
            this.dummyScale.set(sc, sc, sc);
          }
        }
        this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
        this.particleMesh.setMatrixAt(pi, this.dummyMatrix);
      }
      this.particleMesh.instanceMatrix.needsUpdate = true;
    }
  };

  TerrainLayer.prototype.addRippleAtWorld = function (worldX, worldY, worldZ, strength, isWhite) {
    if (!this.platter) return;
    this._rippleLocal = this._rippleLocal || new THREE.Vector3();
    this._rippleLocal.set(worldX, worldY, worldZ);
    this.platter.worldToLocal(this._rippleLocal);
    this.addRipple(this._rippleLocal.x, this._rippleLocal.z, strength, isWhite);
  };

  TerrainLayer.prototype.setVisible = function (visible) {
    this.group.visible = !!visible;
  };


  TerrainLayer.prototype.setTheme = function (theme) {
    this.theme = cloneTheme(theme);
    applyThemeUniforms(this.material && this.material.uniforms, this.theme);
    applyThemeUniforms(this.floatMat && this.floatMat.uniforms, this.theme);
    if (this.meteorMat) this.meteorMat.color.copy(colorFromArr(this.theme.uWarmCore));
    if (this.particleMat) this.particleMat.color.copy(colorFromArr(this.theme.uRippleColor));
  };

  TerrainLayer.prototype.resetTheme = function () {
    this.setTheme(DEFAULT_INK_THEME);
  };

  TerrainLayer.prototype.dispose = function () {
    this.disposeMesh();
    this.disposeFloatMesh();
    if (this.meteorMesh) {
      this.platter.remove(this.meteorMesh);
      this.meteorMesh.geometry.dispose();
      this.meteorMat.dispose();
      this.meteorMesh = null;
      this.meteorMat = null;
    }
    if (this.particleMesh) {
      this.platter.remove(this.particleMesh);
      this.particleMesh.geometry.dispose();
      this.particleMat.dispose();
      this.particleMesh = null;
      this.particleMat = null;
    }
    if (this.group.parent) this.group.parent.remove(this.group);
    this.gridKey = '';
  };

  global.TerrainLayer = TerrainLayer;
  global.TERRAIN_INK_THEME = INK_THEME;
  global.TERRAIN_DEFAULT_INK_THEME = DEFAULT_INK_THEME;
  global.normalizeTerrainTheme = cloneTheme;
})(typeof window !== 'undefined' ? window : globalThis);
