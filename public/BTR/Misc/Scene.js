"use strict"

const RBXScene = (() => {
	class Scene extends EventEmitter {
		constructor() {
			super()
			this._prevRes = { width: -1, height: -1 }
			this.cameraControlsEnabled = true

			this.cameraMinZoom = 2
			this.cameraMaxZoom = 25
			this.cameraZoom = 10
			this.cameraSlide = 0
			this.cameraSlideEnabled = true
			this.cameraFocus = new THREE.Vector3(0, 4, 0)
			this.cameraOffset = new THREE.Vector3(0, 0, 0)
			this.cameraRotation = new THREE.Euler(.05, 0, 0, "YXZ")
			this.cameraDir = new THREE.Vector3(0, 0, 1)
			this.prevDragEvent = null
			this.isDragging = false

			/** When true (launcher freecam): force closest zoom, block zoom-out, smooth mouselook targets. */
			this.launcherFreecamZoomLock = false
			this.launcherFreecamLookSmooth = false
			this._launcherLookTargetX = this.cameraRotation.x
			this._launcherLookTargetY = this.cameraRotation.y
			this._sceneLastPerfMs = typeof performance !== "undefined" ? performance.now() : 0

			/** Profile-picture composer: extra yaw (rad) and zoom multiplier (higher = closer). */
			this._composerYawRad = 0
			this._composerZoomMul = 1
			this._orbitScratchEuler = new THREE.Euler(0, 0, 0, "YXZ")

			const renderer = this.renderer = new THREE.WebGLRenderer({
				antialias: true,
				alpha: true,
				logarithmicDepthBuffer: true
			})
			const maxPixelRatio = Number(globalThis.BTR_MAX_PIXEL_RATIO ?? 1.5)
			renderer.setPixelRatio(Math.min(Math.max(1, maxPixelRatio), Math.max(1, globalThis.devicePixelRatio || 1)))

			renderer.setClearAlpha(0)
			renderer.shadowMap.enabled = true
			renderer.shadowMap.type = THREE.PCFSoftShadowMap
			if("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
				renderer.outputColorSpace = THREE.SRGBColorSpace
			} else if("outputEncoding" in renderer && THREE.sRGBEncoding) {
				renderer.outputEncoding = THREE.sRGBEncoding
			}
			if("toneMapping" in renderer && THREE.ACESFilmicToneMapping !== undefined) {
				renderer.toneMapping = THREE.ACESFilmicToneMapping
				renderer.toneMappingExposure = 1.18
			}

			const canvas = this.canvas = renderer.domElement
			canvas.style = `
			user-select: none !important;
			-moz-user-select: none !important;
		
			position: absolute !important;
			left: 0 !important;
			right: 0 !important;
			top: 0 !important;
			bottom: 0 !important;
			width: 100% !important;
			height: 100% !important;`

			const scene = this.scene = new THREE.Scene()
			// Large far plane: avatar preview backgrounds include full glTF maps (MeepCity-scale) that extend well past 100 studs.
			const camera = this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 500000)
			
			const ambientLight = new THREE.AmbientLight(0xE6EEFF, 0.9)
			scene.add(ambientLight)

			const hemiLight = new THREE.HemisphereLight(0xCCE4FF, 0x273043, 0.64)
			scene.add(hemiLight)

			const sunLight = new THREE.DirectionalLight(0xFFF1D8, 1.18)
			sunLight.position.set(-0.474891931, 0.822536945, 0.312906593).multiplyScalar(15)
			sunLight.castShadow = true
			this.sunDirectionalLight = sunLight
			sunLight.shadow.mapSize.width = 256
			sunLight.shadow.mapSize.height = 256
			sunLight.shadow.camera.left = -8
			sunLight.shadow.camera.right = 8
			sunLight.shadow.camera.bottom = -8
			sunLight.shadow.camera.top = 8
			sunLight.shadow.camera.near = 1
			sunLight.shadow.camera.far = 22
			scene.add(sunLight)

			const light2 = new THREE.DirectionalLight(0x8FB9FF, 0.58)
			light2.position.copy(sunLight.position).negate()
			light2.castShadow = false
			scene.add(light2)

			const frontFill = new THREE.DirectionalLight(0xCFE8FF, 0.42)
			frontFill.position.set(6, 4.5, 5)
			frontFill.castShadow = false
			scene.add(frontFill)

			this.listeners = [
				{
					target: canvas,
					events: {
						mousedown: event => {
							if(!this.cameraControlsEnabled) { return }

							if(!this.isDragging && (event.button >= 0 && event.button <= 2)) {
								this.prevDragEvent = event
								this.isDragging = true
								this.dragButton = event.button
							}

							if(document.activeElement) {
								document.activeElement.blur()
							}

							event.preventDefault()
						},
						contextmenu: event => {
							if(!this.cameraControlsEnabled) { return }
							event.preventDefault()
						},
						wheel: {
							handler: event => {
								if(!this.cameraControlsEnabled) { return }

								if(this.launcherFreecamZoomLock) {
									this.cameraZoom = this.cameraMinZoom
									return
								}

								const deltaY = event.deltaY

								if(deltaY > 0) {
									this.cameraZoom = Math.min(this.cameraMaxZoom, this.cameraZoom + 1)
								} else if(deltaY < 0) {
									this.cameraZoom = Math.max(this.cameraMinZoom, this.cameraZoom - 1)
								}
							},
							options: { passive: true }
						}
					}
				},
				{
					target: window,
					events: {
						mousemove: event => {
							if(!this.cameraControlsEnabled) { return }
							
							if(!this.isDragging) { return }
							const pointerLocked = document.pointerLockElement === this.canvas
							let moveX = 0
							let moveY = 0
							if(pointerLocked) {
								moveX = Number(event.movementX) || 0
								moveY = Number(event.movementY) || 0
							} else {
								if(!this.prevDragEvent) {
									this.prevDragEvent = event
									return
								}
								moveX = event.clientX - this.prevDragEvent.clientX
								moveY = event.clientY - this.prevDragEvent.clientY
								this.prevDragEvent = event
							}
							
							if(this.dragButton === 1) {
								this.cameraSlide += this.cameraZoom * moveY / this.canvas.clientHeight

							} else if(pointerLocked && this.launcherFreecamLookSmooth) {
								const sensY = 1.28 * Math.PI / this.canvas.clientHeight
								const sensX = 1.28 * Math.PI / this.canvas.clientWidth
								this._launcherLookTargetX = Math.max(-1.4, Math.min(1.4, this._launcherLookTargetX + sensY * moveY))
								this._launcherLookTargetY -= sensX * moveX
							} else {
								const sens = 2.85 * Math.PI
								const rotX = this.cameraRotation.x + sens * moveY / this.canvas.clientHeight
								this.cameraRotation.x = Math.max(-1.4, Math.min(1.4, rotX))
								this.cameraRotation.y -= sens * moveX / this.canvas.clientWidth
								this._launcherLookTargetX = this.cameraRotation.x
								this._launcherLookTargetY = this.cameraRotation.y
							}
						},
						mouseup: event => {
							if(this.isDragging && event.button === this.dragButton) {
								this.isDragging = false
								this.prevDragEvent = null
							}
						},
						contextmenu: event => {
							if(!this.cameraControlsEnabled) { return }
							
							if(event.button === 2 && event.button === this.dragButton) {
								this.dragButton = null
								event.preventDefault()
							}
						}
					}
				},
				{
					target: document,
					events: {
						pointerlockchange: () => {
							if(document.pointerLockElement === this.canvas) { return }
							this.prevDragEvent = null
							this.isDragging = false
						}
					}
				}
			]
			this._tempFocus = new THREE.Vector3()
			
			for(const listener of this.listeners) {
				for(const [eventName, eventEntry] of Object.entries(listener.events)) {
					if(typeof eventEntry === "function") {
						listener.target.addEventListener(eventName, eventEntry)
						continue
					}

					const handler = eventEntry?.handler
					if(typeof handler !== "function") { continue }
					listener.target.addEventListener(eventName, handler, eventEntry?.options || undefined)
				}
			}
		}

		update() {
			const now = typeof performance !== "undefined" ? performance.now() : 0
			const dt = Math.min(0.08, Math.max(0, (now - (this._sceneLastPerfMs || now)) / 1000))
			this._sceneLastPerfMs = now

			if(this.launcherFreecamZoomLock) {
				this.cameraZoom = this.cameraMinZoom
			}

			if(this.launcherFreecamLookSmooth) {
				// While dragging: snap orbit to targets (raw, responsive). After release: ease for a smooth settle.
				if(this.isDragging) {
					this.cameraRotation.x = this._launcherLookTargetX
					this.cameraRotation.y = this._launcherLookTargetY
				} else {
					const smooth = 1 - Math.exp(-13 * (dt || 0.016))
					this.cameraRotation.x += (this._launcherLookTargetX - this.cameraRotation.x) * smooth
					this.cameraRotation.y += (this._launcherLookTargetY - this.cameraRotation.y) * smooth
				}
			} else {
				this._launcherLookTargetX = this.cameraRotation.x
				this._launcherLookTargetY = this.cameraRotation.y
			}

			const parent = this.canvas.parentNode
			let width = 0
			let height = 0
			if(parent) {
				width = parent.clientWidth
				height = parent.clientHeight
				const res = this._prevRes

				if(width > 1 && height > 1 && (width !== res.width || height !== res.height)) {
					res.width = width
					res.height = height

					this.renderer.setSize(width, height, false)
					this.camera.aspect = width / height
					this.camera.updateProjectionMatrix()
				}
			}

			const view = this.canvas.closest && this.canvas.closest("#avatarView") || (this.canvas.parentNode && this.canvas.parentNode.parentNode) || this.canvas.parentNode
			const inAvatarPage = !!(view && view.id === "avatarView")
			const inSocialProfilePanel = !!(this.canvas.closest && this.canvas.closest("#socialProfilePanel"))

			const yaw = this.cameraRotation.y + (this._composerYawRad || 0)
			this._orbitScratchEuler.set(this.cameraRotation.x, yaw, 0, "YXZ")
			this.cameraDir.set(0, 0, 1).applyEuler(this._orbitScratchEuler)
			
			//
			// Freecam moves cameraFocus in the launcher; orbit slide limits fight vertical movement and feel like invisible walls.
			if(this.cameraSlideEnabled && !this.launcherFreecamZoomLock) {
				let minSlide = 2
				let maxSlide = 5.5
				
				if(this.avatar.playerType === "R15" && this.avatar.joints.LowerTorso) {
					maxSlide =
						this.avatar.hipHeight
						+ this.avatar.parts.HumanoidRootPart.rbxSize[1] / 2
						+ this.avatar.joints.LowerTorso.bakedC0.elements[13]
						+ this.avatar.joints.LowerTorso.bakedC1Inverse.elements[13]
						+ this.avatar.joints.Head.bakedC0.elements[13]
						+ this.avatar.joints.Head.bakedC1Inverse.elements[13]
						+ 1
				}
				
				minSlide -= this.cameraFocus.y + this.cameraOffset.y
				maxSlide -= this.cameraFocus.y + this.cameraOffset.y
				
				this.cameraSlide = Math.max(minSlide, Math.min(maxSlide, this.cameraSlide))
			}
			//
			
			const focus = this._tempFocus.copy(this.cameraFocus)
			focus.add(this.cameraOffset)
			focus.y += this.cameraSlide

			const zoomMul = Math.max(0.28, Math.min(2.4, this._composerZoomMul || 1))
			this.camera.position.copy(focus).addScaledVector(this.cameraDir, -this.cameraZoom / zoomMul)
			this.camera.lookAt(focus)

			// Shift view horizontally (film offset) without changing camera angle.
			// - Avatar page: avatar on the right (legacy behavior)
			// - Social profile: keep room for the panel without pushing the avatar too far left
			this.camera.filmOffset = inAvatarPage ? -12 : inSocialProfilePanel ? 16 : 0
			this.camera.updateProjectionMatrix()

			const groundDiff = 0.2 - this.camera.position.y
			if(!this.launcherFreecamZoomLock && this.cameraDir.y > 0 && groundDiff > 0) {
				this.camera.position.addScaledVector(this.cameraDir, groundDiff / this.cameraDir.y)
			}
		}

		render() {
			this.renderer.render(this.scene, this.camera)
		}

		remove() {
			if(this.started) { this.stop() }
			this.canvas.remove()
			
			for(const listener of this.listeners) {
				for(const [eventName, eventEntry] of Object.entries(listener.events)) {
					if(typeof eventEntry === "function") {
						listener.target.removeEventListener(eventName, eventEntry)
						continue
					}

					const handler = eventEntry?.handler
					if(typeof handler !== "function") { continue }
					listener.target.removeEventListener(eventName, handler, eventEntry?.options || undefined)
				}
			}
		}

		start() {
			if(this.started) { return }
			this.started = true

			const innerUpdate = () => {
				// Global launcher optimization: keep RAF alive but skip heavy scene work
				// while app is unfocused/hidden to reduce GPU + CPU load.
				// Must use === true: when unset, we must NOT pause (undefined !== false was true and blanked the avatar).
				if(globalThis.BTR_PAUSE_WHEN_UNFOCUSED === true) {
					// Only `document.hidden`: `document.hasFocus()` is often false in Electron until the
					// user clicks the webContents, which froze avatar idle animation at cold start.
					if(document.hidden) {
						this._afId = requestAnimationFrame(innerUpdate)
						return
					}
				}

				this.update()
				this.render()
				this._afId = requestAnimationFrame(innerUpdate)
			}

			this._afId = requestAnimationFrame(innerUpdate)
		}

		stop() {
			if(!this.started) { return }
			this.started = false

			cancelAnimationFrame(this._afId)
			delete this._afId
		}
	}

	class AvatarScene extends Scene {
		constructor(options = {}) {
			super()
			this.showAstral = options.showAstral !== false
			if (options.enableShadows === false) {
				this.renderer.shadowMap.enabled = false
				if (this.sunDirectionalLight) {
					this.sunDirectionalLight.castShadow = false
				}
			}
			
			const avatar = this.avatar = new RBXAvatar.Avatar()
			this.scene.add(avatar.root)
			
			this.avatarOffset = {
				position: new THREE.Vector3(),
				rotation: new THREE.Euler()
			}
			this.astralRibbonRigs = []
			this.astralDustFields = []
			this.astralSparkles = []
			this.astralFloatSpheres = []
			if (!this.showAstral) {
				// Skip astral dimension artifacts when background is music video (solid-color only).
				const groundMat = new THREE.ShadowMaterial()
				groundMat.opacity = 0.2
				const ground = new THREE.Mesh(
					new THREE.PlaneGeometry(200, 200),
					groundMat
				)
				ground.frustumCulled = false
				ground.rotation.x = -Math.PI / 2
				ground.position.y = .001
				ground.receiveShadow = true
				this.scene.add(ground)
				this.renderer.clippingPlanes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0)))
				return
			}
			const ribbonColors = [0x7FA8FF, 0x56D9FF, 0xA58DFF, 0x4CC0FF, 0x9BB8FF, 0x75A2FF, 0x6EE7FF]
			const makeRibbonCurve = (radius, verticalOffset, wobble, phase) => {
				const points = []
				const count = 14
				for(let i = 0; i < count; i++) {
					const t = i / (count - 1) * Math.PI * 2
					const radialWobble = 0.96 + 0.04 * Math.sin(t * 3 + phase)
					const r = radius * radialWobble
					const x = Math.cos(t) * r
					const z = Math.sin(t) * r
					const y = verticalOffset
						+ Math.sin(t * 2 + phase) * wobble
						+ Math.cos(t * 5 - phase) * wobble * 0.24
					points.push(new THREE.Vector3(x, y, z))
				}
				return new THREE.CatmullRomCurve3(points, true, "catmullrom", 0.45)
			}

			for(let i = 0; i < ribbonColors.length; i++) {
				const radius = 17 + i * 1.9 + Math.random() * 1.2
				const wobble = 0.1 + Math.random() * 0.1
				const phase = Math.random() * Math.PI * 2
				const yAxisOffset = (Math.random() - 0.5) * 1.4
				const yAxisModifier = 0.7 + Math.random() * 1.2
				const curve = makeRibbonCurve(radius, 2.75 + (i - 3) * 0.12 + yAxisOffset, wobble, phase)
				const yAxisLift = Math.random() < 0.45
					? (1.2 + Math.random() * 2.6)
					: (-0.5 + Math.random() * 1.1)
				const ribbon = new THREE.Mesh(
					new THREE.TubeGeometry(curve, 180, 0.038 + Math.random() * 0.026, 14, true),
					new THREE.MeshBasicMaterial({
						color: ribbonColors[i],
						transparent: true,
						opacity: 0.1 + Math.random() * 0.06,
						blending: THREE.AdditiveBlending,
						depthWrite: false,
						side: THREE.DoubleSide
					})
				)

				ribbon.frustumCulled = false
				ribbon.renderOrder = -3
				ribbon.position.set(0, 0, 0)
				ribbon.position.y = yAxisLift
				ribbon.rotation.set(
					-0.02 + Math.random() * 0.04,
					Math.random() * Math.PI * 2,
					-0.02 + Math.random() * 0.04
				)

				this.scene.add(ribbon)
				this.astralRibbonRigs.push({
					mesh: ribbon,
					baseY: ribbon.position.y,
					baseZ: ribbon.position.z,
					baseRotX: ribbon.rotation.x,
					baseRotZ: ribbon.rotation.z,
					spin: 0.00028 + Math.random() * 0.00042,
					floatSpeed: 0.18 + Math.random() * 0.28,
					floatAmp: 0.02 + Math.random() * 0.04,
					orbitAmp: 0.01 + Math.random() * 0.02,
					phase,
					yAxisOffset,
					yAxisModifier,
					yAxisLift
				})
			}

			const makeDustField = (count, radius, size, color, opacity) => {
				const geometry = new THREE.BufferGeometry()
				const positions = new Float32Array(count * 3)
				for(let i = 0; i < count; i++) {
					const theta = Math.random() * Math.PI * 2
					const v = Math.random() * 2 - 1
					const phi = Math.acos(v)
					const r = radius * (0.88 + Math.random() * 0.42)
					const sinPhi = Math.sin(phi)
					positions[i * 3] = Math.cos(theta) * sinPhi * r
					positions[i * 3 + 1] = 2.8 + (Math.random() - 0.5) * 5.2
					positions[i * 3 + 2] = Math.sin(theta) * sinPhi * r * 0.18
				}
				geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))

				const points = new THREE.Points(
					geometry,
					new THREE.PointsMaterial({
						color,
						size,
						transparent: true,
						opacity,
						blending: THREE.AdditiveBlending,
						depthWrite: false,
						sizeAttenuation: true
					})
				)
				points.frustumCulled = false
				points.renderOrder = -4
				this.scene.add(points)
				return points
			}

			this.astralDustFields.push(makeDustField(180, 30, 0.034, 0xD3E9FF, 0.22))
			this.astralDustFields.push(makeDustField(140, 25, 0.028, 0x8FD5FF, 0.16))

			const sparkleGeometry = new THREE.OctahedronGeometry(1, 0)
			const sparkleColors = [0xD9F4FF, 0xAEE8FF, 0xC9DBFF, 0xE7EEFF]
			for(let i = 0; i < 70; i++) {
				const radius = 9 + Math.random() * 16
				const theta = Math.random() * Math.PI * 2
				const height = 1.2 + Math.random() * 6.2
				const basePosition = new THREE.Vector3(
					Math.cos(theta) * radius,
					height,
					Math.sin(theta) * radius * (0.28 + Math.random() * 0.38)
				)
				const size = 0.03 + Math.random() * 0.065
				const material = new THREE.MeshBasicMaterial({
					color: sparkleColors[(Math.random() * sparkleColors.length) | 0],
					transparent: true,
					opacity: 0.32 + Math.random() * 0.5,
					blending: THREE.AdditiveBlending,
					depthWrite: false
				})
				const sparkle = new THREE.Mesh(sparkleGeometry, material)
				sparkle.position.copy(basePosition)
				sparkle.scale.setScalar(size)
				sparkle.frustumCulled = false
				sparkle.renderOrder = -2
				this.scene.add(sparkle)
				this.astralSparkles.push({
					mesh: sparkle,
					basePosition,
					baseScale: size,
					phase: Math.random() * Math.PI * 2,
					twinkleSpeed: 0.8 + Math.random() * 2.2,
					driftSpeed: 0.08 + Math.random() * 0.28,
					driftRadius: 0.03 + Math.random() * 0.2,
					spin: 0.005 + Math.random() * 0.02
				})
			}

			const sphereGeometry = new THREE.SphereGeometry(1, 14, 12)
			const sphereColors = [0x89B9FF, 0x6FE4FF, 0xB29CFF, 0x9FD4FF, 0x7ED2FF]
			for(let i = 0; i < 26; i++) {
				const radius = 7 + Math.random() * 18
				const theta = Math.random() * Math.PI * 2
				const height = 0.8 + Math.random() * 6.8
				const basePosition = new THREE.Vector3(
					Math.cos(theta) * radius,
					height,
					Math.sin(theta) * radius * (0.35 + Math.random() * 0.45)
				)
				const size = 0.18 + Math.random() * 0.95
				const material = new THREE.MeshStandardMaterial({
					color: sphereColors[(Math.random() * sphereColors.length) | 0],
					transparent: true,
					opacity: 0.08 + Math.random() * 0.15,
					roughness: 0.35 + Math.random() * 0.4,
					metalness: 0.05 + Math.random() * 0.25,
					depthWrite: false
				})
				const sphere = new THREE.Mesh(sphereGeometry, material)
				sphere.position.copy(basePosition)
				sphere.scale.setScalar(size)
				sphere.frustumCulled = false
				sphere.castShadow = false
				sphere.receiveShadow = false
				sphere.renderOrder = -2
				this.scene.add(sphere)
				this.astralFloatSpheres.push({
					mesh: sphere,
					basePosition,
					baseScale: size,
					phase: Math.random() * Math.PI * 2,
					driftSpeed: 0.05 + Math.random() * 0.2,
					driftRadius: 0.08 + Math.random() * 0.45,
					bobAmp: 0.05 + Math.random() * 0.26,
					spinY: 0.001 + Math.random() * 0.0035,
					spinX: 0.0004 + Math.random() * 0.0012
				})
			}
			
			const groundMat = new THREE.ShadowMaterial()
			groundMat.opacity = 0.2

			const ground = new THREE.Mesh(
				new THREE.PlaneGeometry(200, 200),
				groundMat
			)
			ground.frustumCulled = false
			ground.rotation.x = -Math.PI / 2
			ground.position.y = .001
			ground.receiveShadow = true
			this.scene.add(ground)
			
			this.renderer.clippingPlanes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0)))
		}

		update() {
			super.update()
			if (!this.showAstral) {
				this.avatar.offset.set(0, 0.1, 0).add(this.avatarOffset.position)
				this.avatar.offsetRot.copy(this.avatarOffset.rotation)
				this.avatar.update()
				this.trigger("update")
				return
			}
			const time = performance.now() / 1000

			for(const ribbon of this.astralRibbonRigs) {
				const mesh = ribbon.mesh
				mesh.rotation.y += ribbon.spin
				mesh.rotation.x = ribbon.baseRotX + Math.sin(time * ribbon.floatSpeed + ribbon.phase) * 0.02
				mesh.rotation.z = ribbon.baseRotZ + Math.cos(time * ribbon.floatSpeed * 0.86 + ribbon.phase) * 0.025
				mesh.position.y = ribbon.baseY + Math.sin(time * ribbon.floatSpeed * 0.7 + ribbon.phase) * ribbon.floatAmp * ribbon.yAxisModifier
				mesh.position.x = Math.cos(time * ribbon.floatSpeed * 0.37 + ribbon.phase) * ribbon.orbitAmp
				mesh.position.z = ribbon.baseZ + Math.sin(time * ribbon.floatSpeed * 0.41 + ribbon.phase) * ribbon.orbitAmp * 0.08
			}

			for(let i = 0; i < this.astralDustFields.length; i++) {
				const field = this.astralDustFields[i]
				field.rotation.y += 0.00016 * (i + 1)
				field.rotation.x = Math.sin(time * (0.13 + i * 0.07)) * 0.1
			}

			for(const sparkle of this.astralSparkles) {
				const mesh = sparkle.mesh
				const t = time * sparkle.twinkleSpeed + sparkle.phase
				const driftT = time * sparkle.driftSpeed + sparkle.phase
				mesh.position.x = sparkle.basePosition.x + Math.cos(driftT) * sparkle.driftRadius
				mesh.position.y = sparkle.basePosition.y + Math.sin(driftT * 1.6) * sparkle.driftRadius * 0.9
				mesh.position.z = sparkle.basePosition.z + Math.sin(driftT * 1.2) * sparkle.driftRadius * 0.7
				mesh.rotation.x += sparkle.spin * 0.7
				mesh.rotation.y += sparkle.spin
				const pulse = 0.6 + (Math.sin(t) + 1) * 0.32
				mesh.scale.setScalar(sparkle.baseScale * pulse)
				mesh.material.opacity = Math.min(0.95, 0.2 + pulse * 0.65)
			}

			for(const sphere of this.astralFloatSpheres) {
				const mesh = sphere.mesh
				const t = time * sphere.driftSpeed + sphere.phase
				mesh.position.x = sphere.basePosition.x + Math.cos(t * 0.9) * sphere.driftRadius
				mesh.position.y = sphere.basePosition.y + Math.sin(t * 1.5) * sphere.bobAmp
				mesh.position.z = sphere.basePosition.z + Math.sin(t * 0.75) * sphere.driftRadius * 0.75
				mesh.rotation.y += sphere.spinY
				mesh.rotation.x += sphere.spinX
				mesh.material.opacity = 0.08 + (Math.sin(t * 0.85) + 1) * 0.045
			}
			
			this.avatar.offset.set(0, 0.1, 0).add(this.avatarOffset.position)
			this.avatar.offsetRot.copy(this.avatarOffset.rotation)
			
			this.avatar.update()
			this.trigger("update")
		}

		start() {
			if(!this.hasInit) {
				this.hasInit = true
				this.avatar.init()
			}
			super.start()
		}
	}

	return {
		Scene,
		AvatarScene
	}
})()

if(typeof globalThis !== "undefined") {
	globalThis.RBXScene = RBXScene
}
