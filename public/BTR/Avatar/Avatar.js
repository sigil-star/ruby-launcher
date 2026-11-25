"use strict"

const RBXAvatar = (() => {
	if(typeof globalThis !== "undefined" && typeof globalThis.BTR_WRAP_DEBUG === "undefined") {
		globalThis.BTR_WRAP_DEBUG = true
	}

	function createDeferredPromise() {
		let resolveFn
		let rejectFn
		const promise = new Promise((resolve, reject) => {
			resolveFn = resolve
			rejectFn = reject
		})
		promise.$resolve = resolveFn
		promise.$reject = rejectFn
		return promise
	}

	function getFirstLod(mesh) {
		if(!mesh.firstLod && mesh.lods.length > 2) {
			const firstLod = mesh.firstLod = {
				...mesh,
				faces: mesh.faces.subarray(mesh.lods[0] * 3, mesh.lods[1] * 3),
				lods: mesh.lods.slice(0, 2)
			}
			
			let maxVertex = 0
			
			for(let i = firstLod.faces.length; i--;) {
				maxVertex = Math.max(maxVertex, firstLod.faces[i])
			}
			
			maxVertex += 1
			
			if(maxVertex < firstLod.vertices.length / 3) {
				if(firstLod.skinIndices) {
					firstLod.skinIndices = firstLod.skinIndices.subarray(0, maxVertex * 4)
					firstLod.skinWeights = firstLod.skinWeights.subarray(0, maxVertex * 4)
				}
				
				firstLod.vertices = firstLod.vertices.subarray(0, maxVertex * 3)
				firstLod.normals = firstLod.normals.subarray(0, maxVertex * 3)
				firstLod.uvs = firstLod.uvs.subarray(0, maxVertex * 2)
			}
		}
		
		return mesh.firstLod ?? mesh
	}

	function getHeadGap(heightScale = 1, dynamicHead = false) {
		const v = Number(globalThis.BTR_HEAD_WRAP_OFFSET)
		const clamped = Number.isFinite(v) ? Math.min(5, Math.max(-5, v)) : 0.2
		if(!dynamicHead) { return clamped }
		const h = Number(heightScale)
		const clampedHeight = Number.isFinite(h) ? Math.min(1.2, Math.max(0.8, h)) : 1
		const extra = Math.max(0, clampedHeight - 1) * 0.8
		return clamped + extra
	}

	function clampDynamicHoodAboveHead(acc, avatar, matrix, heightScale = 1, dynamicHead = false, useLayeredHead = false) {
		if(globalThis.BTR_HOOD_ACCURATE !== false) { return }
		if(!acc?.wrapLayer) { return }
		if(!HeadGapEligibleAccessoryTypeIds.has(Number(acc?.asset?.assetTypeId))) { return }

		const h = Number(heightScale)
		const clampedHeight = Number.isFinite(h) ? Math.min(1.2, Math.max(0.8, h)) : 1
		const treatAsDynamic = !!dynamicHead || clampedHeight > 1
		if(!treatAsDynamic || clampedHeight <= 1) { return }

		const headPart = avatar?.parts?.Head
		const headMatrix = useLayeredHead ? headPart?.layeredMatrix : headPart?.matrixNoScale
		const headY = Number(headMatrix?.elements?.[13])
		if(!Number.isFinite(headY)) { return }

		// Dynamic heads can include ears/horns in mesh extents; that inflates rbxSize.y and
		// leaves layered hood pieces floating. Prefer canonical/default head bodypart height.
		const defaultHeadSizeY = Number(headPart?.rbxDefaultBodypart?.size?.[1])
		const currentHeadSizeY = Number(headPart?.rbxSize?.[1])
		let referenceHeadSizeY = Number.isFinite(defaultHeadSizeY) ? defaultHeadSizeY : currentHeadSizeY
		if(Number.isFinite(currentHeadSizeY) && Number.isFinite(defaultHeadSizeY)) {
			referenceHeadSizeY = Math.min(currentHeadSizeY, defaultHeadSizeY)
		}
		const headHalfHeight = Number.isFinite(referenceHeadSizeY) ? Math.max(0.1, referenceHeadSizeY / 2) : 0.5
		const rawSlack = Number(globalThis.BTR_DYNAMIC_HOOD_MAX_ABOVE_TOP)
		const slack = Number.isFinite(rawSlack) ? Math.min(0.4, Math.max(-0.2, rawSlack)) : -0.06
		const extraHeight = Math.max(0, clampedHeight - 1)
		const rawBias = Number(globalThis.BTR_DYNAMIC_HOOD_HEIGHT_BIAS)
		const biasStrength = Number.isFinite(rawBias) ? Math.min(4, Math.max(0, rawBias)) : 1.6
		const dynamicBias = extraHeight * biasStrength
		const allowedY = headY + headHalfHeight + slack - dynamicBias

		if(matrix?.elements?.[13] > allowedY) {
			matrix.elements[13] = allowedY
		}
	}

	function getDynamicHeadHoodVertexDrop(acc, heightScale = 1, dynamicHead = false) {
		if(globalThis.BTR_HOOD_ACCURATE !== false) { return 0 }
		if(!acc?.wrapLayer) { return 0 }
		if(!HeadGapEligibleAccessoryTypeIds.has(Number(acc?.asset?.assetTypeId))) { return 0 }

		const h = Number(heightScale)
		const clampedHeight = Number.isFinite(h) ? Math.min(1.2, Math.max(0.8, h)) : 1
		const treatAsDynamic = !!dynamicHead || clampedHeight > 1
		if(!treatAsDynamic || clampedHeight <= 1) { return 0 }

		const extraHeight = Math.min(0.2, Math.max(0, clampedHeight - 1))
		const raw = Number(globalThis.BTR_DYNAMIC_HOOD_VERTEX_DROP)
		const strength = Number.isFinite(raw) ? Math.min(10, Math.max(0, raw)) : 7
		return extraHeight * strength
	}

	function applyTopWeightedVertexDrop(vertices, drop) {
		if(!(vertices instanceof Float32Array) || vertices.length < 6) { return }
		if(!Number.isFinite(drop) || drop <= 0) { return }

		let minY = Infinity
		let maxY = -Infinity
		for(let i = 1; i < vertices.length; i += 3) {
			const y = vertices[i]
			if(y < minY) { minY = y }
			if(y > maxY) { maxY = y }
		}

		const range = maxY - minY
		if(!Number.isFinite(range) || range <= 1e-6) { return }

		// Affect only the upper section to avoid pulling torso/body wrap down.
		const start = minY + range * 0.68
		const denom = Math.max(1e-6, maxY - start)

		for(let i = 1; i < vertices.length; i += 3) {
			const y = vertices[i]
			if(y <= start) { continue }
			const t = Math.min(1, Math.max(0, (y - start) / denom))
			vertices[i] = y - drop * (t * t)
		}
	}

	function shouldApplyLayeredHeadFollowFallback(acc) {
		if(!acc?.wrapLayer) { return false }
		if(!HeadGapEligibleAccessoryTypeIds.has(Number(acc?.asset?.assetTypeId))) { return false }
		// If parent is already head, rigid parent-follow is usually sufficient.
		if(acc?.parent?.name === "Head") { return false }
		return true
	}

	function applyLayeredHeadFollowFallback(acc, headDeltaWorld, headAnchorWorld = null, objectScale = null) {
		if(!shouldApplyLayeredHeadFollowFallback(acc)) { return }
		const obj = acc?.obj
		const geom = obj?.geometry
		const positionAttr = geom?.getAttribute?.("position")
		if(!positionAttr) { return }
		const currentMatrix = obj.matrixNoScale
		if(!currentMatrix) { return }
		const scaleXRaw = Number(objectScale?.x ?? obj?.scale?.x ?? 1)
		const scaleYRaw = Number(objectScale?.y ?? obj?.scale?.y ?? 1)
		const scaleZRaw = Number(objectScale?.z ?? obj?.scale?.z ?? 1)
		const scaleX = Math.abs(scaleXRaw) > 1e-6 ? scaleXRaw : 1
		const scaleY = Math.abs(scaleYRaw) > 1e-6 ? scaleYRaw : 1
		const scaleZ = Math.abs(scaleZRaw) > 1e-6 ? scaleZRaw : 1
		const currentScaledMatrix = tempMatrix3.copy(currentMatrix).scale(tempVector2.set(scaleX, scaleY, scaleZ))

		let state = acc.headFollowDeformer
		const positionArray = positionAttr.array
		if(!state || state.vertexCount !== positionAttr.count || state.version !== obj.rbxHeadFollowVersion) {
			const basePositions = Float32Array.from(positionArray)
			let minY = Infinity
			let maxY = -Infinity
			for(let i = 1; i < basePositions.length; i += 3) {
				const y = basePositions[i]
				if(y < minY) { minY = y }
				if(y > maxY) { maxY = y }
			}
			const range = maxY - minY
			// Use full height so entire hood follows head motion; torso wrap stability handled by damped weights.
			const topFractionRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_TOP_FRACTION)
			const topFraction = Number.isFinite(topFractionRaw)
				? clampNumber(topFractionRaw, 0.1, 0.95, 0.15)
				: 0.15
			const rigidTopFractionRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_RIGID_TOP_FRACTION)
			const rigidTopDefault = Math.min(0.95, topFraction + 0.2)
			const rigidTopFraction = Number.isFinite(rigidTopFractionRaw)
				? clampNumber(rigidTopFractionRaw, Math.min(0.98, topFraction + 0.02), 0.98, rigidTopDefault)
				: rigidTopDefault
			const startY = minY + range * topFraction
			const rigidStartY = minY + range * rigidTopFraction
			state = acc.headFollowDeformer = {
				version: obj.rbxHeadFollowVersion,
				vertexCount: positionAttr.count,
				basePositions: basePositions,
				bindObjectMatrix: currentScaledMatrix.clone(),
				startY: startY,
				denom: Math.max(1e-6, maxY - startY),
				rigidStartY: rigidStartY,
				rigidDenom: Math.max(1e-6, maxY - rigidStartY)
			}
		}
		if(!state.bindObjectMatrix) {
			state.bindObjectMatrix = currentScaledMatrix.clone()
		}

		const debugFollow = !!globalThis.BTR_WRAP_DEBUG
		const debugMeta = debugFollow ? {
			assetId: acc?.asset?.id,
			name: acc?.asset?.name || acc?.obj?.name,
			hasAnchorWorld: !!headAnchorWorld,
			hasBind: !!state.bindObjectMatrix,
			headDelta: {
				tx: Number(headDeltaWorld?.elements?.[12]) || 0,
				ty: Number(headDeltaWorld?.elements?.[13]) || 0,
				tz: Number(headDeltaWorld?.elements?.[14]) || 0
			}
		} : null

		const strengthRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_STRENGTH)
		const strength = Number.isFinite(strengthRaw) ? clampNumber(strengthRaw, 0, 3, 1.15) : 1.15
		if(strength <= 0) { return }
		const rigidStrengthRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_RIGID_STRENGTH)
		const rigidStrength = Number.isFinite(rigidStrengthRaw)
			? clampNumber(rigidStrengthRaw, 0, 3, 1.6)
			: 1.6
		const translationBiasRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_TRANSLATION_BIAS)
		const translationBias = Number.isFinite(translationBiasRaw)
			? clampNumber(translationBiasRaw, 0, 1, 0.65)
			: 0.65
		const maxShiftRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_SHIFT)
		const maxShift = Number.isFinite(maxShiftRaw)
			? clampNumber(maxShiftRaw, 0.01, 0.4, 0.12)
			: 0.12
		const maxRigidShiftRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_RIGID_SHIFT)
		const maxRigidShift = Number.isFinite(maxRigidShiftRaw)
			? clampNumber(maxRigidShiftRaw, 0.03, 0.6, 0.22)
			: 0.22
		const maxVerticalRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_VERTICAL_SHIFT)
		const maxVerticalShift = Number.isFinite(maxVerticalRaw)
			? clampNumber(maxVerticalRaw, 0.01, 0.3, 0.08)
			: 0.08
		const maxRigidVerticalRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_RIGID_VERTICAL_SHIFT)
		const maxRigidVerticalShift = Number.isFinite(maxRigidVerticalRaw)
			? clampNumber(maxRigidVerticalRaw, 0.02, 0.45, 0.16)
			: 0.16
		const anchorStrengthRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_ANCHOR_STRENGTH)
		const anchorStrength = Number.isFinite(anchorStrengthRaw)
			? clampNumber(anchorStrengthRaw, 0, 3, 2.8)
			: 2.8
		const anchorInnerRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_ANCHOR_INNER_RADIUS)
		const anchorInnerRadius = Number.isFinite(anchorInnerRaw)
			? clampNumber(anchorInnerRaw, 0.05, 2, 0.55)
			: 0.55
		const anchorOuterRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_ANCHOR_OUTER_RADIUS)
		const anchorOuterRadius = Number.isFinite(anchorOuterRaw)
			? clampNumber(anchorOuterRaw, anchorInnerRadius + 1e-3, 3, 1.4)
			: 1.4
		const maxAnchorShiftRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_ANCHOR_SHIFT)
		const maxAnchorShift = Number.isFinite(maxAnchorShiftRaw)
			? clampNumber(maxAnchorShiftRaw, 0.03, 0.5, 0.28)
			: 0.28
		const maxAnchorVerticalRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_ANCHOR_VERTICAL_SHIFT)
		const maxAnchorVerticalShift = Number.isFinite(maxAnchorVerticalRaw)
			? clampNumber(maxAnchorVerticalRaw, 0.03, 0.45, 0.18)
			: 0.18
		const hardAnchorThresholdRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_HARD_ANCHOR_THRESHOLD)
		const hardAnchorThreshold = Number.isFinite(hardAnchorThresholdRaw)
			? clampNumber(hardAnchorThresholdRaw, 0, 1, 0.25)
			: 0.25
		const maxHardAnchorShiftRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_HARD_ANCHOR_SHIFT)
		const maxHardAnchorShift = Number.isFinite(maxHardAnchorShiftRaw)
			? clampNumber(maxHardAnchorShiftRaw, 0.05, 1, 0.6)
			: 0.6
		const maxHardAnchorVerticalRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_HARD_ANCHOR_VERTICAL_SHIFT)
		const maxHardAnchorVerticalShift = Number.isFinite(maxHardAnchorVerticalRaw)
			? clampNumber(maxHardAnchorVerticalRaw, 0.05, 0.7, 0.42)
			: 0.42
		const hardAnchorMinRigidRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_HARD_ANCHOR_MIN_RIGID)
		const hardAnchorMinRigid = Number.isFinite(hardAnchorMinRigidRaw)
			? clampNumber(hardAnchorMinRigidRaw, 0, 1, 0.22)
			: 0.22

		let hasAnchor = false
		let anchorX = 0
		let anchorY = 0
		let anchorZ = 0
		if(headAnchorWorld?.elements) {
			tempMatrix.copy(currentScaledMatrix).invert().multiply(headAnchorWorld)
			anchorX = tempMatrix.elements[12]
			anchorY = tempMatrix.elements[13]
			anchorZ = tempMatrix.elements[14]
			hasAnchor = Number.isFinite(anchorX) && Number.isFinite(anchorY) && Number.isFinite(anchorZ)
		}

		// Debug-visualize the anchor the hood is following (requires Debug Vision toggle in UI).
		if(debugFollow && globalThis.BTR_DEBUG_VISION) {
			const ensureAnchorHelper = () => {
				if(acc._debugAnchorHelper && acc._debugAnchorHelper.parent) { return acc._debugAnchorHelper }
				const helper = new THREE.AxesHelper(0.35)
				helper.material.depthTest = false
				helper.material.transparent = true
				helper.material.opacity = 0.85
				let root = obj
				while(root?.parent) { root = root.parent }
				root?.add(helper)
				acc._debugAnchorHelper = helper
				return helper
			}
			const helper = ensureAnchorHelper()
			helper.visible = hasAnchor
			if(helper.visible && headAnchorWorld?.elements) {
				helper.matrixAutoUpdate = false
				helper.matrix.copy(headAnchorWorld)
				helper.matrix.decompose(helper.position, helper.quaternion, helper.scale)
				helper.updateMatrixWorld(true)
			}
		} else if(acc._debugAnchorHelper) {
			acc._debugAnchorHelper.visible = false
		}

		// Use head delta rotation only; ignore head translation to prevent sliding relative to torso anchors.
		// Keep this on a separate temp matrix so subsequent tempMatrix reuse does not overwrite it.
		const headDeltaNoTrans = tempMatrix2.copy(headDeltaWorld)
		headDeltaNoTrans.elements[12] = 0
		headDeltaNoTrans.elements[13] = 0
		headDeltaNoTrans.elements[14] = 0

		const bindObjectMatrix = state.bindObjectMatrix || currentScaledMatrix
		const localDelta = tempMatrix.copy(currentScaledMatrix).invert().multiply(headDeltaNoTrans).multiply(bindObjectMatrix)
		const e = localDelta.elements
		const localTranslationDampingRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_LOCAL_TRANSLATION_DAMPING)
		const localTranslationDamping = Number.isFinite(localTranslationDampingRaw)
			? clampNumber(localTranslationDampingRaw, 0, 1, 0.9)
			: 0.9
		const localTranslationYDampingRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_LOCAL_TRANSLATION_Y_DAMPING)
		const localTranslationYDamping = Number.isFinite(localTranslationYDampingRaw)
			? clampNumber(localTranslationYDampingRaw, 0, 1, 0.92)
			: 0.92
		const maxLocalXZRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_LOCAL_TRANSLATION_XZ)
		const maxLocalXZ = Number.isFinite(maxLocalXZRaw)
			? clampNumber(maxLocalXZRaw, 0.01, 0.4, 0.16)
			: 0.16
		const maxLocalYRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_MAX_LOCAL_TRANSLATION_Y)
		const maxLocalY = Number.isFinite(maxLocalYRaw)
			? clampNumber(maxLocalYRaw, 0.01, 0.35, 0.12)
			: 0.12
		const localRotationBoostRaw = Number(globalThis.BTR_HOOD_HEAD_FOLLOW_LOCAL_ROTATION_BOOST)
		const localRotationBoost = Number.isFinite(localRotationBoostRaw)
			? clampNumber(localRotationBoostRaw, 0.5, 2.5, 1.3)
			: 1.3

		// Emotes can introduce large translational head motion; damp/clamp it so
		// hood follow behaves like anchored rotation instead of sliding.
		e[12] *= localTranslationDamping
		e[13] *= localTranslationYDamping
		e[14] *= localTranslationDamping
		// Boost rotational delta so hood follows head turns more than torso drift.
		e[0] = 1 + (e[0] - 1) * localRotationBoost
		e[1] *= localRotationBoost
		e[2] *= localRotationBoost
		e[4] *= localRotationBoost
		e[5] = 1 + (e[5] - 1) * localRotationBoost
		e[6] *= localRotationBoost
		e[8] *= localRotationBoost
		e[9] *= localRotationBoost
		e[10] = 1 + (e[10] - 1) * localRotationBoost
		e[13] = Math.max(-maxLocalY, Math.min(maxLocalY, e[13]))
		const localHorizLen = Math.sqrt(e[12] * e[12] + e[14] * e[14])
		if(localHorizLen > maxLocalXZ) {
			const s = maxLocalXZ / Math.max(1e-6, localHorizLen)
			e[12] *= s
			e[14] *= s
		}

		const base = state.basePositions
		const out = positionArray

		for(let i = 0; i < base.length; i += 3) {
			const bx = base[i + 0]
			const by = base[i + 1]
			const bz = base[i + 2]
			if(by <= state.startY) {
				out[i + 0] = bx
				out[i + 1] = by
				out[i + 2] = bz
				continue
			}

			const t = Math.min(1, Math.max(0, (by - state.startY) / state.denom))
			const rigidT = by <= state.rigidStartY
				? 0
				: Math.min(1, Math.max(0, (by - state.rigidStartY) / state.rigidDenom))
			let anchorT = 0
			if(hasAnchor) {
				const adx = bx - anchorX
				const ady = by - anchorY
				const adz = bz - anchorZ
				const dist = Math.sqrt(adx * adx + ady * ady + adz * adz)
				if(dist <= anchorOuterRadius) {
					anchorT = dist <= anchorInnerRadius
						? 1
						: 1 - (dist - anchorInnerRadius) / Math.max(1e-6, anchorOuterRadius - anchorInnerRadius)
				}
			}
			const w = Math.min(1, t * t * strength)
			// Rotate around the head anchor (HatAttachment/Head) when available so the hood pivots at the skull instead of torso origin.
			const ax = hasAnchor ? bx - anchorX : bx
			const ay = hasAnchor ? by - anchorY : by
			const az = hasAnchor ? bz - anchorZ : bz
			const tx = e[0] * ax + e[4] * ay + e[8] * az + e[12] + (hasAnchor ? anchorX : 0)
			const ty = e[1] * ax + e[5] * ay + e[9] * az + e[13] + (hasAnchor ? anchorY : 0)
			const tz = e[2] * ax + e[6] * ay + e[10] * az + e[14] + (hasAnchor ? anchorZ : 0)
			const ttx = bx + e[12]
			const tty = by + e[13]
			const ttz = bz + e[14]

			let dx
			let dy
			let dz
			let maxLen
			let vertClamp
			const rigidInfluence = Math.max(rigidT, anchorT)
			const hardAnchor = anchorT >= hardAnchorThreshold && rigidT >= hardAnchorMinRigid

			if(hardAnchor) {
				// Hard-lock inner anchor zone so headband-like geometry follows head turns.
				dx = tx - bx
				dy = ty - by
				dz = tz - bz
				maxLen = maxHardAnchorShift * (0.6 + 0.4 * anchorT)
				vertClamp = maxHardAnchorVerticalShift * (0.6 + 0.4 * anchorT)
			} else if(rigidInfluence > 0) {
				const rigidW = Math.min(1, Math.max(rigidT * rigidStrength, anchorT * anchorStrength))
				dx = (tx - bx) * rigidW
				dy = (ty - by) * rigidW
				dz = (tz - bz) * rigidW
				maxLen = Math.max(
					maxRigidShift * (0.5 + 0.5 * rigidT),
					maxAnchorShift * (0.4 + 0.6 * anchorT)
				)
				vertClamp = Math.max(
					maxRigidVerticalShift * (0.5 + 0.5 * rigidT),
					maxAnchorVerticalShift * (0.4 + 0.6 * anchorT)
				)
			} else {
			const targetX = ttx + (tx - ttx) * (1 - translationBias)
			const targetY = tty + (ty - tty) * (1 - translationBias)
			const targetZ = ttz + (tz - ttz) * (1 - translationBias)
			dx = (targetX - bx) * w
			dy = (targetY - by) * w
			dz = (targetZ - bz) * w
			maxLen = maxShift * (0.25 + 0.75 * t)
			vertClamp = maxVerticalShift * (0.3 + 0.7 * t)
			}

			dy = Math.max(-vertClamp, Math.min(vertClamp, dy))

			const lenSq = dx * dx + dy * dy + dz * dz
			if(lenSq > maxLen * maxLen) {
				const invLen = 1 / Math.sqrt(Math.max(1e-9, lenSq))
				dx *= maxLen * invLen
				dy *= maxLen * invLen
				dz *= maxLen * invLen
			}

			out[i + 0] = bx + dx
			out[i + 1] = by + dy
			out[i + 2] = bz + dz
		}

		positionAttr.needsUpdate = true
	}

	function applyHeadGapOffset(acc, parent, heightScale = 1, dynamicHead = false) {
		if(!acc?.wrapLayer || !acc?.bakedCFrame) { return }
		if(!HeadGapEligibleAccessoryTypeIds.has(Number(acc?.asset?.assetTypeId))) { return }
		if(dynamicHead && Number(heightScale) > 1) { return }

		if(globalThis.BTR_HOOD_ACCURATE !== false) { return } // keep Roblox-authored wrap

		// Only adjust true head/face accessories to avoid disturbing body wrap.
		const isHeadish = parent?.name === "Head" || acc.attachments?.some(a => /head|face/i.test(a?.name || ""))
		if(!isHeadish) { return }

		const headGap = getHeadGap(heightScale, dynamicHead)
		acc.bakedCFrame.elements[13] -= (headGap + 0.02)
	}

	function isHeadish(acc, parent) {
		return parent?.name === "Head" || acc.attachments?.some(a => /head|face/i.test(a?.name || ""))
	}

	function shouldApplyHeadGapOffset(acc, parent, heightScale = 1, dynamicHead = false) {
		if(globalThis.BTR_HOOD_ACCURATE !== false) { return false }
		if(!acc?.wrapLayer) { return false }
		if(!HeadGapEligibleAccessoryTypeIds.has(Number(acc?.asset?.assetTypeId))) { return false }
		if(dynamicHead && Number(heightScale) > 1) { return false }
		return isHeadish(acc, parent)
	}

	function hasDynamicHeadEquipped(avatar) {
		if(!avatar) { return false }
		if(Array.isArray(avatar.assets) && avatar.assets.some(asset =>
			asset?.enabled !== false && Number(asset?.assetTypeId) === AssetType.DynamicHead
		)) {
			return true
		}
		return Number(avatar.parts?.Head?.rbxBodypart?.asset?.assetTypeId) === AssetType.DynamicHead
	}

	if(typeof globalThis !== "undefined") {
		globalThis.applyHeadGapOffset = applyHeadGapOffset
		globalThis.forceRewrapLayeredClothing = avatar => {
			if(!avatar) { return }
			if(avatar.scales) {
				avatar.wrapScales = { ...(avatar.wrapScales || {}), ...avatar.scales }
			}
			avatar.layeredCurrentRequest = null
			avatar.layeredFinishedRequest = null
			avatar.layeredFailedRequest = null
			avatar.shouldRefreshLayeredClothing = true
			try {
				if(typeof btrLocalStorage !== "undefined" && typeof btrLocalStorage.keys === "function") {
					for(const key of (btrLocalStorage.keys() || [])) {
						if(String(key).startsWith("btrLayeredCache-")) {
							btrLocalStorage.removeItem(key)
						}
					}
				}
			} catch {}
			if(typeof avatar._refreshLayeredClothing === "function") {
				avatar._refreshLayeredClothing()
			}
		}
	}
	
	function applyMesh(obj, mesh) {
		if(!mesh || !mesh.vertices || !mesh.normals || !mesh.uvs || !mesh.faces) {
			if(obj) obj.visible = false
			return
		}
		const geom = obj.geometry
		const vertexCount = Math.floor((mesh.vertices.length ?? 0) / 3)
		const ensureDummySkinAttributes = () => {
			const skinIndex = geom.getAttribute("skinIndex")
			const skinWeight = geom.getAttribute("skinWeight")
			
			if(!skinIndex || skinIndex.count !== vertexCount) {
				geom.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(vertexCount * 4), 4))
			}
			
			if(!skinWeight || skinWeight.count !== vertexCount) {
				geom.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Float32Array(vertexCount * 4), 4))
			}
		}
		
		if(obj instanceof THREE.SkinnedMesh) {
			if(obj.skeleton) {
				obj.skeleton.dispose()
				delete obj.skeleton
			}
			
			const hasValidSkinData =
				!!mesh.bones
				&& !!mesh.skinIndices
				&& !!mesh.skinWeights
				&& mesh.skinIndices.length >= vertexCount * 4
				&& mesh.skinWeights.length >= vertexCount * 4
			
			if(hasValidSkinData) {
				const bones = []
				
				obj.isSkinnedMesh = true
				obj.rbxBones = bones
				
				geom.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(mesh.skinIndices, 4))
				geom.setAttribute("skinWeight", new THREE.Float32BufferAttribute(mesh.skinWeights, 4))
				
				const boneCount = {}
				
				for(let i = 0; i < mesh.skinIndices.length; i++) {
					if((mesh.skinWeights[i] ?? 0) > 0) {
						const boneIndex = mesh.skinIndices[i]
						boneCount[boneIndex] = (boneCount[boneIndex] ?? 0) + 1
					}
				}
				
				for(const [i, meshBone] of Object.entries(mesh.bones)) {
					const bone = {
						name: meshBone.name,
						cframe: CFrameToMatrix4(...meshBone.cframe),
						count: boneCount[i] ?? 0,
						
						matrixWorld: new THREE.Matrix4(),
						inverse: new THREE.Matrix4()
					}
					
					bones.push(bone)
				}
				
				obj.skeleton = new THREE.Skeleton(bones, bones.map(x => x.inverse))
				
				obj.skeleton.btr_apply = obj.skeleton.update
				obj.skeleton.update = () => {}
				
				obj.bind(obj.skeleton, new THREE.Matrix4())
				
			} else {
				obj.isSkinnedMesh = false
				delete obj.rbxBones

				// Always replace skin attributes with zeros to avoid reusing stale weighted data.
				const zeroSkinIndex = new Uint16Array(vertexCount * 4)
				const zeroSkinWeight = new Float32Array(vertexCount * 4)
				geom.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(zeroSkinIndex, 4))
				geom.setAttribute("skinWeight", new THREE.Float32BufferAttribute(zeroSkinWeight, 4))

				// Provide a minimal skeleton so three.js skinned helpers don't crash when invoked.
				const dummyBone = new THREE.Bone()
				dummyBone.matrixWorld.identity()
				obj.skeleton = new THREE.Skeleton([dummyBone], [new THREE.Matrix4().identity()])
				obj.bind(obj.skeleton, new THREE.Matrix4())
			}
		}
		
		delete obj.rbxLayered
		
		geom.setAttribute("position", new THREE.BufferAttribute(mesh.vertices, 3))
		geom.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3))
		geom.setAttribute("uv", new THREE.BufferAttribute(mesh.uvs, 2))
		geom.setIndex(new THREE.BufferAttribute(mesh.faces, 1))
		
		// geom.computeBoundingSphere()

		if(mesh.facs) {
			obj.rbxFacs = mesh.facs
		} else {
			delete obj.rbxFacs
		}

		obj.visible = true
	}
	
	function clearGeometry(obj) {
		const geom = obj.geometry

		if(obj instanceof THREE.SkinnedMesh) {
			if(obj.skeleton) {
				obj.skeleton.dispose()
				delete obj.skeleton
			}
			
			obj.isSkinnedMesh = false
			delete obj.rbxBones
			
			geom.deleteAttribute("skinIndex")
			geom.deleteAttribute("skinWeight")
		}
		
		delete obj.rbxLayered
		delete obj.rbxFacs
		
		geom.deleteAttribute("position")
		geom.deleteAttribute("normal")
		geom.deleteAttribute("uv")
		geom.setIndex(null)

		// geom.computeBoundingSphere()

		obj.visible = false
	}

	function CFrameToMatrix4(x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22) {
		return new THREE.Matrix4().fromArray([
			r00, r10, r20, 0,
			r01, r11, r21, 0,
			r02, r12, r22, 0,
			x, y, z, 1
		])
	}
	
	const scalePosition = (matrix, scale) => {
		const elements = matrix.elements
		elements[12] *= scale.x
		elements[13] *= scale.y
		elements[14] *= scale.z
		return matrix
	}
	
	function solidColorDataURL(r, g, b) {
		return `data:image/gif;base64,R0lGODlhAQABAPAA${btoa(String.fromCharCode(0, r, g, b, 255, 255))}/yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==`
	}

	function createImage(src) {
		const img = new Image()
		img.src = src
		img.crossOrigin = "anonymous"
		img.updateListeners = []

		return img
	}
	
	function createTexture(img) {
		const texture = new THREE.Texture(img)
		texture.minFilter = THREE.LinearFilter
		texture.wrapS = THREE.RepeatWrapping
		texture.wrapT = THREE.RepeatWrapping
		
		if("colorSpace" in texture && THREE.SRGBColorSpace) {
			texture.colorSpace = THREE.SRGBColorSpace
		} else if("encoding" in texture && THREE.sRGBEncoding) {
			texture.encoding = THREE.sRGBEncoding
		}
		
		texture.needsUpdate = true
		
		return texture
	}

	/** Normalize Roblox Color3 (0–1 or 0–255, may exceed 1 for emissive HDR). */
	function normalizeRgbComponents(r, g, b) {
		r = Number(r) || 0
		g = Number(g) || 0
		b = Number(b) || 0
		const maxC = Math.max(r, g, b)
		if(maxC > 1 && maxC <= 255) {
			r /= 255
			g /= 255
			b /= 255
		}
		return [r, g, b]
	}

	function normalizeRgbArray(rgb) {
		if(!rgb || !rgb.length) { return [1, 1, 1] }
		return normalizeRgbComponents(rgb[0], rgb[1], rgb[2])
	}

	/** Split HDR Color3 into lit base color + emissive glow (RoValra / Roblox emissive pattern). */
	function applyHdrColor3ToMaterial(material, r, g, b) {
		if(!material) { return }
		;[r, g, b] = normalizeRgbComponents(r, g, b)
		const maxC = Math.max(r, g, b, 0.0001)
		if(maxC > 1) {
			material.color.setRGB(r / maxC, g / maxC, b / maxC)
			material.emissive.setRGB(r / maxC, g / maxC, b / maxC)
			material.emissiveIntensity = maxC
		} else {
			material.color.setRGB(r, g, b)
			if(!material.emissiveMap) {
				material.emissive.setRGB(0, 0, 0)
				material.emissiveIntensity = 1
			}
		}
		material.needsUpdate = true
	}

	function applyEmissiveMapToMaterial(material, emissiveMapId, emissiveStrength, emissiveTint) {
		if(!material || !emissiveMapId) { return }
		const strength = emissiveStrength ?? 1
		const tint = normalizeRgbArray(emissiveTint || [1, 1, 1])
		AssetCache.loadImage(true, emissiveMapId, img => {
			if(!img || material.emissiveMapId !== emissiveMapId) { return }
			material.emissiveMap = createTexture(img)
			material.emissive.setRGB(...tint)
			material.emissiveIntensity = strength
			material.needsUpdate = true
		})
		material.emissiveMapId = emissiveMapId
	}
	
	class MergeSource {
		static fromRGB(r, g, b) {
			return (new MergeSource()).setRGB(r, g, b)
		}
		
		static fromHex(hex) {
			return (new MergeSource()).setHex(hex)
		}
		
		constructor(value) {
			this._value = value || null
			this.listeners = []
		}
		
		getImage() {
			if(this._value instanceof Image) {
				return this._value
			} else if(typeof this._value === "string") {
				const rgb = parseInt(this._value.slice(1), 16)
				return createImage(solidColorDataURL(rgb >> 16 & 255, rgb >> 8 & 255, rgb & 255))
			}
			
			return emptyImage
		}
		
		drawImage(ctx, canvas) {
			if(this._value instanceof Image) {
				ctx.drawImage(this._value, 0, 0, this._value.width, this._value.height, 0, 0, canvas.width, canvas.height)
				
			} else if(typeof this._value === "function") {
				this._value(ctx, canvas)
				
			} else if(typeof this._value === "string") {
				ctx.fillStyle = this._value
				ctx.fillRect(0, 0, canvas.width, canvas.height)
			}
		}
		
		getValue() {
			return this._value
		}
		
		setValue(value) {
			if(this._value !== (value || null)) {
				this._value = value || null
				this.update()
			}
			
			return this
		}
		
		setHex(hex) { return this.setValue(hex[0] !== "#" ? "#" + hex : hex) }
		setRGB(r, g, b) { return this.setValue("#" + (new THREE.Color(r, g, b)).getHexString()) }
		setImage(img) { return this.setValue(img) }
		
		toTexture() {
			return createTexture(this.getImage())
		}
		
		update() {
			for(const listener of this.listeners) {
				listener(this)
			}
		}
		
		onUpdate(listener) {
			this.listeners.push(listener)
		}
		
		removeOnUpdate(listener) {
			const index = this.listeners.indexOf(listener)
			
			if(index !== -1) {
				this.listeners.splice(index, 1)
			}
		}
	}
	
	class MergeTexture extends THREE.Texture {
		constructor(width, height, ...sources) {
			const canvas = document.createElement("canvas")
			canvas.width = width
			canvas.height = height
			
			super(canvas)
			
			this.minFilter = THREE.LinearFilter
			this.wrapS = THREE.RepeatWrapping
			this.wrapT = THREE.RepeatWrapping
			if("colorSpace" in this && THREE.SRGBColorSpace) {
				this.colorSpace = THREE.SRGBColorSpace
			} else if("encoding" in this && THREE.sRGBEncoding) {
				this.encoding = THREE.sRGBEncoding
			}
			
			this.canvas = canvas
			this.context = canvas.getContext("2d")
			this.stack = []
			
			this.sourceListener = source => {
				for(const entry of this.stack) {
					if(entry.source === source) {
						entry.dirty = true
						this.requestUpdate()
					}
				}
			}
			
			for(let source of sources) {
				if(!source) continue
				if(source instanceof Image) {
					source = new MergeSource(source)
				}
				
				this.stack.push({ source: source, dirty: true, enabled: true })
				source.onUpdate(this.sourceListener)
			}
			
			this.requestUpdate()
		}
		
		setSourceEnabled(index, isEnabled) {
			const entry = this.stack[index]
			
			if(entry.enabled !== isEnabled) {
				entry.enabled = isEnabled
				entry.dirty = true
				this.requestUpdate()
			}
		}
		
		requestUpdate() {
			this.btrNeedsUpdate = true
		}
		
		update() {
			this.btrNeedsUpdate = false
			
			if(!this.stack.some(x => x.dirty)) {
				return
			}
			
			this.context.clearRect(0, 0, this.canvas.width, this.canvas.height)
			
			for(const entry of this.stack) {
				entry.dirty = false
				
				if(entry.enabled) {
					entry.source.drawImage(this.context, this.canvas)
				}
			}
			
			this.needsUpdate = true
		}
		
		dispose() {
			for(const entry of this.stack) {
				entry.source.removeOnUpdate(this.sourceListener)
			}
			
			super.dispose()
		}
	}

	const emptyImage = createImage("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=")
	
	const LocalAssets = {
		"res/previewer/characterModels.rbxm": "rbxassetid://11829118051&version=1",
		"res/previewer/face.png": "rbxassetid://2957705858",
		
		"res/previewer/meshes/leftarm.mesh": "rbxassetid://2957740508",
		"res/previewer/meshes/leftleg.mesh": "rbxassetid://2957740624",
		"res/previewer/meshes/rightarm.mesh": "rbxassetid://2957740703",
		"res/previewer/meshes/rightleg.mesh": "rbxassetid://2957740776",
		"res/previewer/meshes/torso.mesh": "rbxassetid://2957740857",
		"res/previewer/heads/head.mesh": "rbxassetid://2957715294",
	
		"res/previewer/compositing/CompositPantsTemplate.mesh": "rbxassetid://2957742558",
		"res/previewer/compositing/CompositShirtTemplate.mesh": "rbxassetid://2957742631",
		"res/previewer/compositing/CompositTShirt.mesh": "rbxassetid://2957742706",
		"res/previewer/compositing/R15CompositLeftArmBase.mesh": "rbxassetid://2957742791",
		"res/previewer/compositing/R15CompositRightArmBase.mesh": "rbxassetid://2957742881",
		"res/previewer/compositing/R15CompositTorsoBase.mesh": "rbxassetid://2957742957"
	}
	
	const BodyPartEnum = [null, "Torso", "Left Arm", "Right Arm", "Left Leg", "Right Leg"]
	const R15FolderPriority = ["R15ArtistIntent", "R15", "R15Fixed"]
	const HeadMeshes = {
		"rbxasset://avatar/heads/head.mesh": "rbxassetid://2957715294",
		"rbxasset://avatar/heads/headA.mesh": "rbxassetid://2957717479",
		"rbxasset://avatar/heads/headB.mesh": "rbxassetid://2957719621",
		"rbxasset://avatar/heads/headC.mesh": "rbxassetid://2957735435",
		"rbxasset://avatar/heads/headD.mesh": "rbxassetid://2957735527",
		"rbxasset://avatar/heads/headE.mesh": "rbxassetid://2957735616",
		"rbxasset://avatar/heads/headF.mesh": "rbxassetid://2957735708",
		"rbxasset://avatar/heads/headG.mesh": "rbxassetid://2957735779",
		"rbxasset://avatar/heads/headH.mesh": "rbxassetid://2957735870",
		"rbxasset://avatar/heads/headI.mesh": "rbxassetid://2957735956",
		"rbxasset://avatar/heads/headJ.mesh": "rbxassetid://2957736171",
		"rbxasset://avatar/heads/headK.mesh": "rbxassetid://2957736290",
		"rbxasset://avatar/heads/headL.mesh": "rbxassetid://2957736404",
		"rbxasset://avatar/heads/headM.mesh": "rbxassetid://2957736496",
		"rbxasset://avatar/heads/headN.mesh": "rbxassetid://2957736621",
		"rbxasset://avatar/heads/headO.mesh": "rbxassetid://2957736751",
		"rbxasset://avatar/heads/headP.mesh": "rbxassetid://2957736879"
	}
	
	const BodyAssetTypeIds = [
		AssetType.DynamicHead, AssetType.Head, AssetType.Torso, AssetType.RightArm,
		AssetType.LeftArm, AssetType.LeftLeg, AssetType.RightLeg
	]

	const AccessoryAssetTypeIds = [
		AssetType.Hat,
		AssetType.HairAccessory,
		AssetType.FaceAccessory,
		AssetType.NeckAccessory,
		AssetType.ShoulderAccessory,
		AssetType.FrontAccessory,
		AssetType.BackAccessory,
		AssetType.WaistAccessory,
		AssetType.EarAccessory,
		AssetType.EyeAccessory,
		AssetType.TShirtAccessory,
		AssetType.ShirtAccessory,
		AssetType.PantsAccessory,
		AssetType.JacketAccessory,
		AssetType.SweaterAccessory,
		AssetType.ShortsAccessory,
		AssetType.LeftShoeAccessory,
		AssetType.RightShoeAccessory,
		AssetType.DressSkirtAccessory,
		AssetType.EyebrowAccessory,
		AssetType.EyelashAccessory
	]

	const HeadGapEligibleAccessoryTypeIds = new Set([
		AssetType.TShirtAccessory,
		AssetType.ShirtAccessory,
		AssetType.JacketAccessory,
		AssetType.SweaterAccessory
	])

	const LayeredBodyClothingTypeIds = new Set([
		AssetType.TShirtAccessory,
		AssetType.ShirtAccessory,
		AssetType.JacketAccessory,
		AssetType.SweaterAccessory,
		AssetType.PantsAccessory,
		AssetType.ShortsAccessory,
		AssetType.DressSkirtAccessory
	])

	const HeadAnchorAttachmentNames = new Set([
		"HatAttachment",
		"HairAttachment",
		"FaceFrontAttachment",
		"FaceCenterAttachment"
	])

	const TorsoAnchorAttachmentNames = new Set([
		"BodyFrontAttachment",
		"BodyBackAttachment",
		"LeftCollarAttachment",
		"RightCollarAttachment",
		"NeckAttachment",
		"WaistCenterAttachment",
		"WaistFrontAttachment",
		"WaistBackAttachment"
	])

	const HeadFollowPreferredAttachmentNames = [
		"HatAttachment",
		"HairAttachment",
		"FaceFrontAttachment",
		"FaceCenterAttachment",
		"NeckRigAttachment",
		"NeckAttachment"
	]
	// Roblox R6 tool hold baseline (matches Studio tool-grip editor dummy-arm offset).
	// Must use local CFrameToMatrix4 — RBXAvatar is not assigned until this IIFE returns.
	// Y slightly past -1 stud pulls the handle toward the palm vs the bare attachment point.
	const R6ToolGripOffset = CFrameToMatrix4(0, -1.06, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0)
	const GearGripAttachmentNames = [
		"RightGripAttachment",
		"RightHandGripAttachment",
		"RightWristRigAttachment",
		"RightHandAttachment"
	]

	class AvatarAsset extends EventEmitter {
		constructor(assetId, assetTypeId, meta) {
			$.assert(Number.isSafeInteger(assetTypeId), "no assetTypeId")
			super()
			
			this.id = assetId
			this.assetTypeId = assetTypeId
			this.meta = meta
			
			this.active = true
			this.enabled = true
			this.priority = 1
			
			this.states = {}
		}

		isEmpty() {
			for(const state of Object.values(this.states)) {
				if(state.accessories.length || state.bodyparts.length || state.clothing.length) {
					return false
				}
			}
			
			return true
		}
		
		get(requestedPlayerType) {
			let playerType
			
			const request = {}
			
			if(BodyAssetTypeIds.includes(this.assetTypeId) || AccessoryAssetTypeIds.includes(this.assetTypeId)) {
				playerType = requestedPlayerType !== "R6" ? "R15" : "R6"
				
				if(this.assetTypeId === AssetType.Head || this.assetTypeId === AssetType.DynamicHead) {
					request.format = "avatar_meshpart_head"
				} else if(AccessoryAssetTypeIds.includes(this.assetTypeId)) {
					request.format = "avatar_meshpart_accessory"
				}
			} else if(this.assetTypeId === AssetType.Gear) {
				/* Gear is a Tool/Model package. avatar_meshpart_accessory makes assetdelivery return 500 for type 19. */
				playerType = requestedPlayerType !== "R6" ? "R15" : "R6"
			}
			
			const requestKey = `${playerType ?? ""}/${request.format ?? ""}`
			
			if(!this.states[requestKey]) {
				this.states[requestKey] = {
					playerType: playerType,
					request: request,
					
					loaded: false,
					loading: false,
					loadPromise: createDeferredPromise(),
					
					accessories: [],
					bodyparts: [],
					clothing: [],
				}
			}
			
			return this.states[requestKey]
		}

		load(...loadParams) {
			const state = this.get(...loadParams)
			if(!state) { return null }
			
			if(state.loaded || state.loading) { return state }
			state.loading = true

			const finish = success => {
				state.loading = false
				state.loaded = true

				if(this.active) { this.trigger("update") }
				state.loadPromise.$resolve()
			}
			
			AssetCache.loadModel(this.id, state.request, model => {
				if(!this.active) { return }
				if(!model) { return finish(false) }
				
				this.loaders = []
				
				switch(this.assetTypeId) {
				case AssetType.TShirt:
					state.clothing.push({
						asset: this,
						target: "tshirt",
						texId: this.validateAndPreload("Image", model[0].Graphic)
					})
					break
				case AssetType.Shirt:
					state.clothing.push({
						asset: this,
						target: "shirt",
						texId: this.validateAndPreload("Image", model[0].ShirtTemplate)
					})
					break
				case AssetType.Pants:
					state.clothing.push({
						asset: this,
						target: "pants",
						texId: this.validateAndPreload("Image", model[0].PantsTemplate)
					})
					break
				case AssetType.Face:
					state.clothing.push({
						asset: this,
						target: "face",
						texId: this.validateAndPreload("Image", model[0].Texture)
					})
					break
				
				case AssetType.DynamicHead:
				case AssetType.Head:
				case AssetType.Torso:
				case AssetType.RightArm:
				case AssetType.LeftArm:
				case AssetType.LeftLeg:
				case AssetType.RightLeg: {
					/* Dynamic/live heads nest under folders; shallow scan misses them on R6. MeshPart-only heads have no SpecialMesh — loadPackage finds MeshPart Head + decals. */
					if((this.assetTypeId === AssetType.DynamicHead || this.assetTypeId === AssetType.Head) && state.playerType === "R6") {
						this.loadPackage(state, model)
						break
					}
					const R15Folders = []
					
					for(const child of model) {
						if(child.ClassName === "SpecialMesh" && state.playerType === "R6") {
							if(this.assetTypeId === AssetType.Head || this.assetTypeId === AssetType.DynamicHead) {
								this.loadHeadR6(state, child)
							}
							
						} else if(child.ClassName === "MeshPart" && state.playerType === "R15") {
							if(this.assetTypeId === AssetType.Head || this.assetTypeId === AssetType.DynamicHead) {
								this.loadBodyPartsR15(state, [child])
							}
							
						} else if(child.ClassName === "Folder") {
							if(child.Name === "R6" && state.playerType === "R6") {
								this.loadBodyPartsR6(state, child.Children)
								
							} else if(R15FolderPriority.includes(child.Name) && state.playerType === "R15") {
								R15Folders.push(child)
							}
						}
					}
					
					if(R15Folders.length > 0) {
						R15Folders.sort((a, b) => R15FolderPriority.indexOf(a.Name) - R15FolderPriority.indexOf(b.Name))
						this.loadBodyPartsR15(state, R15Folders[0].Children)
					}
					
					break
				}
				case AssetType.Package:
					this.loadPackage(state, model)
					break
				case AssetType.Gear: {
					const roots = Array.isArray(model) ? model : [model]
					let toolInst = null
					for (const root of roots) {
						if (!root || typeof root !== "object") { continue }
						if (root.ClassName === "Tool") {
							toolInst = root
							break
						}
						const stack = [root]
						while (stack.length && !toolInst) {
							const node = stack.pop()
							if (!node || typeof node !== "object") { continue }
							if (node.ClassName === "Tool") {
								toolInst = node
								break
							}
							const ch = Array.isArray(node.Children) ? node.Children : []
							for (let i = ch.length; i--;) { stack.push(ch[i]) }
						}
						if (toolInst) { break }
					}
					const accRoot = toolInst || roots[0]
					if (accRoot) { this.loadAccessory(state, accRoot) }
					break
				}
				
				default:
					if(AccessoryAssetTypeIds.includes(this.assetTypeId)) {
						this.loadAccessory(state, model[0])
					}
				}

				Promise.allSettled(this.loaders).then(() => finish(true))
				delete this.loaders
			})

			return state
		}

		setEnabled(enabled) {
			if(this.enabled !== !!enabled) {
				this.enabled = !!enabled
				if(this.active) { this.trigger("update") }
			}
		}

		setPriority(priority) {
			this.priority = priority
			if(this.active) { this.trigger("update") }
		}

		remove() {
			if(!this.active) { return }
			this.active = false
			this.trigger("remove")
		}
		
		validateAndPreload(assetType, assetUrl) {
			if(!assetUrl || !AssetCache.isValidAssetUrl(assetUrl) || !this.loaders) {
				return null
			}
			
			switch(assetType) {
			case "Mesh":
				this.loaders.push(AssetCache.loadMesh(true, assetUrl))
				break
			case "Image":
				this.loaders.push(AssetCache.loadImage(true, assetUrl))
				break
			default:
				throw new Error("Invalid assetType")
			}
			
			return assetUrl
		}
		
		loadHeadR6(state, mesh) {
			const scaleTypeValue = mesh.Children.find(x => x.Name === "AvatarPartScaleType")
			const scaleType = scaleTypeValue ? scaleTypeValue.Value : null
			const sourceAssetId = Number(mesh.SourceAssetId)
			
			const bp = {
				asset: this,
				attachments: [],
				target: "Head",
				sourceAssetId: Number.isSafeInteger(sourceAssetId) && sourceAssetId > 0 ? sourceAssetId : null,
				
				meshId: this.validateAndPreload("Mesh", HeadMeshes[mesh.MeshId] || mesh.MeshId),
				texId: this.validateAndPreload("Image", mesh.TextureId),
				
				/* R15 dynamic heads set disableFace when no face Decal; R6 must match or the Head composite keeps the default classic face (smile) on top of the mesh. */
				disableFace: this.assetTypeId === AssetType.DynamicHead || mesh.Tags?.includes("NoFace"),
				
				scale: [...mesh.Scale],
				scaleType: scaleType
			}
			
			for(const inst of mesh.Children) {
				if(inst.ClassName !== "Vector3Value" || !inst.Name.endsWith("Attachment")) { continue }
				
				bp.attachments.push({
					target: inst.Name,
					cframe: new THREE.Matrix4().setPosition(...inst.Value),

					part: "Head",
					scaleType: scaleType
				})
			}
			
			state.bodyparts.push(bp)
		}

		loadBodyPartsR6(state, charmeshes) {
			for(const charmesh of charmeshes) {
				const target = BodyPartEnum[charmesh.BodyPart]
				if(!target) { continue }
				const sourceAssetId = Number(charmesh.SourceAssetId)
				
				state.bodyparts.push({
					asset: this,
					attachments: [],
					target: target,
					sourceAssetId: Number.isSafeInteger(sourceAssetId) && sourceAssetId > 0 ? sourceAssetId : null,

					meshId: this.validateAndPreload("Mesh", charmesh.MeshId ? AssetCache.toAssetUrl(charmesh.MeshId) : null),
					texId: this.validateAndPreload("Image", charmesh.OverlayTextureId ? AssetCache.toAssetUrl(charmesh.OverlayTextureId) : null),
					
					baseTexId: this.validateAndPreload("Image", charmesh.BaseTextureId ? AssetCache.toAssetUrl(charmesh.BaseTextureId) : null)
				})
			}
		}

		loadBodyPartsR15(state, parts) {
			for(const part of parts) {
				if(part.ClassName !== "MeshPart") { continue }
				
				const scaleTypeValue = part.Children.find(x => x.Name === "AvatarPartScaleType")
				const scaleType = scaleTypeValue ? scaleTypeValue.Value : null
				
				const size = part.Size || part.size || [1, 1, 1]
				const initialSize = part.InitialSize || size
				const sourceAssetId = Number(part.SourceAssetId)
				const sx = initialSize[0] || 1
				const sy = initialSize[1] || 1
				const sz = initialSize[2] || 1
				
				const bp = {
					asset: this,
					attachments: [],
					target: part.Name,
					sourceAssetId: Number.isSafeInteger(sourceAssetId) && sourceAssetId > 0 ? sourceAssetId : null,
					
					meshId: this.validateAndPreload("Mesh", part.MeshID || part.MeshId),
					opacity: 1 - (part.Transparency || 0),
					
					scale: [size[0] / sx, size[1] / sy, size[2] / sz],
					size: [...size],

					scaleType: scaleType
				}
				
				if(this.assetTypeId === AssetType.Head || this.assetTypeId === AssetType.DynamicHead) {
					bp.disableFace = !part.Children.find(x => x.ClassName === "Decal" && x.Name.toLowerCase() === "face")
				}
				
				const surfaceAppearance = part.Children.find(x => x.ClassName === "SurfaceAppearance")
				
				if(surfaceAppearance) {
					bp.pbrEnabled = true
					bp.pbrAlphaMode = surfaceAppearance.AlphaMode ?? 0
					
					bp.colorMapId = this.validateAndPreload("Image", surfaceAppearance.ColorMap)
					bp.normalMapId = this.validateAndPreload("Image", surfaceAppearance.NormalMap)
					bp.roughnessMapId = this.validateAndPreload("Image", surfaceAppearance.RoughnessMap)
					bp.metalnessMapId = this.validateAndPreload("Image", surfaceAppearance.MetalnessMap)
					const emissiveMask = surfaceAppearance.EmissiveMaskContent ?? surfaceAppearance.EmissiveMask
					if(emissiveMask) {
						bp.emissiveMapId = this.validateAndPreload("Image", emissiveMask)
						bp.emissiveStrength = surfaceAppearance.EmissiveStrength ?? 1
						bp.emissiveTint = surfaceAppearance.EmissiveTint ? [...surfaceAppearance.EmissiveTint] : [1, 1, 1]
					}
				} else {
					bp.texId = this.validateAndPreload("Image", part.TextureID || part.TextureId)
				}
				
				const wrapTarget = part.Children.find(x => x.ClassName === "WrapTarget")
				
				if(wrapTarget) {
					bp.wrapTarget = {
						cageMeshId: wrapTarget.CageMeshId ?? "",
						cageOrigin: RBXAvatar.CFrameToMatrix4(...wrapTarget.CageOrigin),
						stiffness: wrapTarget.Stiffness ?? 0
					}
				}
				
				for(const inst of part.Children) {
					if(inst.ClassName !== "Attachment") { continue }
					
					bp.attachments.push({
						target: inst.Name,
						cframe: RBXAvatar.CFrameToMatrix4(...inst.CFrame),

						part: part.Name,
						scaleType: scaleType
					})
				}
				
				state.bodyparts.push(bp)
			}
		}

		loadPackage(state, model) {
			const stack = Array.isArray(model) ? [...model] : []
			const r15Folders = []
			const r15Parts = []
			const r6CharMeshes = []
			const r6HeadMeshes = []
			const r6HeadMeshParts = []

			while(stack.length) {
				const inst = stack.pop()
				if(!inst || typeof inst !== "object") { continue }

				const children = Array.isArray(inst.Children) ? inst.Children : []

				switch(inst.ClassName) {
				case "Accessory":
					this.loadAccessory(state, inst)
					break
				case "Shirt":
					state.clothing.push({
						asset: this,
						target: "shirt",
						texId: this.validateAndPreload("Image", inst.ShirtTemplate)
					})
					break
				case "Pants":
					state.clothing.push({
						asset: this,
						target: "pants",
						texId: this.validateAndPreload("Image", inst.PantsTemplate)
					})
					break
				case "ShirtGraphic":
					state.clothing.push({
						asset: this,
						target: "tshirt",
						texId: this.validateAndPreload("Image", inst.Graphic)
					})
					break
				case "Decal":
					if(String(inst.Name || "").toLowerCase() === "face") {
						state.clothing.push({
							asset: this,
							target: "face",
							texId: this.validateAndPreload("Image", inst.Texture)
						})
					}
					break
				case "SpecialMesh":
					if(state.playerType === "R6" && (String(inst.Name || "").toLowerCase().includes("head") || this.assetTypeId === AssetType.DynamicHead)) {
						r6HeadMeshes.push(inst)
					}
					break
				case "CharacterMesh":
					if(state.playerType === "R6") {
						r6CharMeshes.push(inst)
					}
					break
				case "MeshPart":
					if(state.playerType === "R15" && R15BodyPartNames.includes(inst.Name)) {
						r15Parts.push(inst)
					} else if(
						state.playerType === "R6" &&
						inst.Name === "Head" &&
						(this.assetTypeId === AssetType.DynamicHead || this.assetTypeId === AssetType.Head)
					) {
						r6HeadMeshParts.push(inst)
					}
					break
				case "Folder":
					if(state.playerType === "R15" && R15FolderPriority.includes(inst.Name)) {
						r15Folders.push(inst)
					}
					break
				}

				if(children.length) {
					stack.push(...children)
				}
			}

			if(state.playerType === "R15") {
				if(r15Folders.length > 0) {
					r15Folders.sort((a, b) => R15FolderPriority.indexOf(a.Name) - R15FolderPriority.indexOf(b.Name))
					this.loadBodyPartsR15(state, r15Folders[0].Children)
				} else if(r15Parts.length > 0) {
					this.loadBodyPartsR15(state, r15Parts)
				}
			} else if(state.playerType === "R6") {
				if(r6CharMeshes.length > 0) {
					this.loadBodyPartsR6(state, r6CharMeshes)
				}

				if(r6HeadMeshParts.length > 0) {
					this.loadBodyPartsR15(state, [r6HeadMeshParts[0]])
				} else if(r6HeadMeshes.length > 0) {
					this.loadHeadR6(state, r6HeadMeshes[0])
				}
			}
		}

		loadAccessory(state, accInst) {
			const hanInst = accInst.Children.find(x => x.Name === "Handle")
			if(!hanInst) { return }
			
			const scaleTypeValue = hanInst.Children.find(x => x.Name === "AvatarPartScaleType")
			const scaleType = scaleTypeValue ? scaleTypeValue.Value : null
			
			let baseColor = hanInst.Color || hanInst.Color3uint8
			if(!baseColor) {
				const brickColor = BrickColor[hanInst.BrickColor] || BrickColor[194]
				baseColor = brickColor.color.map(x => x / 255)
			}
			
			const acc = {
				asset: this,
				attachments: [],
				
				baseColor: [...baseColor],
				opacity: 1 - (hanInst.Transparency || 0),
				
				legacyHatCFrame: accInst.AttachmentPoint ? RBXAvatar.CFrameToMatrix4(...accInst.AttachmentPoint).invert() : new THREE.Matrix4(),
				scaleType: scaleType,

				// Particles, lights, beams and trails under the Handle (Effects.js), and Neon, which glows.
				effects: globalThis.RBXEffects ? globalThis.RBXEffects.collectEffects(hanInst) : [],
				neon: hanInst.Material === 288
			}
			if(accInst?.ClassName === "Tool") {
				let toolGripMatrix = null
				const grip = accInst.Grip
				if(Array.isArray(grip) && grip.length >= 12) {
					toolGripMatrix = RBXAvatar.CFrameToMatrix4(...grip)
				} else {
					const gp = accInst.GripPos
					const gr = accInst.GripRight
					const gu = accInst.GripUp
					const gf = accInst.GripForward
					if(Array.isArray(gp) && gp.length >= 3 && Array.isArray(gr) && gr.length >= 3 && Array.isArray(gu) && gu.length >= 3 && Array.isArray(gf) && gf.length >= 3) {
						const pos = new THREE.Vector3(gp[0], gp[1], gp[2])
						const right = new THREE.Vector3(gr[0], gr[1], gr[2])
						const up = new THREE.Vector3(gu[0], gu[1], gu[2])
						const forward = new THREE.Vector3(gf[0], gf[1], gf[2])
						const back = forward.clone().multiplyScalar(-1)
						toolGripMatrix = new THREE.Matrix4().set(
							right.x, up.x, back.x, pos.x,
							right.y, up.y, back.y, pos.y,
							right.z, up.z, back.z, pos.z,
							0, 0, 0, 1
						)
					}
				}
				if(toolGripMatrix) {
					acc.toolGripInverse = toolGripMatrix.clone().invert()
				}
			}

			for(let att of hanInst.Children) {
				if(att.ClassName === "Attachment") {
					acc.attachments.push({
						name: att.Name,
						cframe: RBXAvatar.CFrameToMatrix4(...att.CFrame).invert()
					})
				}
			}
			
			if(hanInst.ClassName === "MeshPart") {
				const size = hanInst.Size || hanInst.size
				const initialSize = hanInst.InitialSize
				
				acc.scale = [size[0] / initialSize[0], size[1] / initialSize[1], size[2] / initialSize[2]]
				acc.meshId = this.validateAndPreload("Mesh", hanInst.MeshID || hanInst.MeshId)
				
				const surfaceAppearance = hanInst.Children.find(x => x.ClassName === "SurfaceAppearance")
				if(surfaceAppearance) {
					acc.pbrEnabled = true
					acc.pbrAlphaMode = surfaceAppearance.AlphaMode ?? 0
					
					acc.colorMapId = this.validateAndPreload("Image", surfaceAppearance.ColorMap)
					acc.normalMapId = this.validateAndPreload("Image", surfaceAppearance.NormalMap)
					acc.roughnessMapId = this.validateAndPreload("Image", surfaceAppearance.RoughnessMap)
					acc.metalnessMapId = this.validateAndPreload("Image", surfaceAppearance.MetalnessMap)
					const emissiveMask = surfaceAppearance.EmissiveMaskContent ?? surfaceAppearance.EmissiveMask
					if(emissiveMask) {
						acc.emissiveMapId = this.validateAndPreload("Image", emissiveMask)
						acc.emissiveStrength = surfaceAppearance.EmissiveStrength ?? 1
						acc.emissiveTint = surfaceAppearance.EmissiveTint ? [...surfaceAppearance.EmissiveTint] : [1, 1, 1]
					}
				} else {
					acc.texId = this.validateAndPreload("Image", hanInst.TextureID || hanInst.TextureId)
				}
				
				const wrapLayer = hanInst.Children.find(x => x.ClassName === "WrapLayer")
				if(wrapLayer && wrapLayer.Enabled !== false) { // Enabled defaults to true for some ungodly reason
					acc.wrapLayer = {
						cageMeshId: wrapLayer.CageMeshId ?? "",
						cageOrigin: RBXAvatar.CFrameToMatrix4(...wrapLayer.CageOrigin),
						refMeshId: wrapLayer.ReferenceMeshId ?? "",
						refOrigin: RBXAvatar.CFrameToMatrix4(...wrapLayer.ReferenceOrigin),
						puffiness: wrapLayer.Puffiness ?? 0,
						order: wrapLayer.Order ?? 0,
						autoSkin: wrapLayer.AutoSkin !== undefined ? !!wrapLayer.AutoSkin : true
					}
				}
			} else {
				const meshInst = hanInst.Children.find(x => x.ClassName === "SpecialMesh")
				if(!meshInst) { return }
				
				acc.meshId = this.validateAndPreload("Mesh", meshInst.MeshId)
				acc.texId = this.validateAndPreload("Image", meshInst.TextureId)
				
				acc.vertexColor = meshInst.VertexColor ? [...meshInst.VertexColor] : null
				acc.offset = meshInst.Offset ? [...meshInst.Offset] : null
				acc.scale = meshInst.Scale ? [...meshInst.Scale] : null
			}
			
			state.accessories.push(acc)
		}
	}
	
	const R6BodyPartNames = ["Torso", "Left Arm", "Right Arm", "Left Leg", "Right Leg"]
	const R15BodyPartNames = [
		"LeftFoot", "LeftHand", "LeftLowerArm", "LeftLowerLeg", "LeftUpperArm", "LeftUpperLeg", "LowerTorso",
		"RightFoot", "RightHand", "RightLowerArm", "RightLowerLeg", "RightUpperArm", "RightUpperLeg", "UpperTorso"
	]
	
	const ScaleMods = {
		Default: {
			LeftFoot: new THREE.Vector3(1.0789999961853027, 1.2669999599456787, 1.128999948501587),
			LeftHand: new THREE.Vector3(1.065999984741211, 1.1740000247955322, 1.2309999465942383),
			LeftLowerArm: new THREE.Vector3(1.128999948501587, 1.3420000076293945, 1.1319999694824219),
			LeftLowerLeg: new THREE.Vector3(1.0230000019073486, 1.50600004196167, 1.0230000019073486),
			LeftUpperArm: new THREE.Vector3(1.128999948501587, 1.3420000076293945, 1.1319999694824219),
			LeftUpperLeg: new THREE.Vector3(1.0230000019073486, 1.50600004196167, 1.0230000019073486),
			LowerTorso: new THREE.Vector3(1.0329999923706055, 1.309000015258789, 1.1399999856948853),
			RightFoot: new THREE.Vector3(1.0789999961853027, 1.2669999599456787, 1.128999948501587),
			RightHand: new THREE.Vector3(1.065999984741211, 1.1740000247955322, 1.2309999465942383),
			RightLowerArm: new THREE.Vector3(1.128999948501587, 1.3420000076293945, 1.1319999694824219),
			RightLowerLeg: new THREE.Vector3(1.0230000019073486, 1.50600004196167, 1.0230000019073486),
			RightUpperArm: new THREE.Vector3(1.128999948501587, 1.3420000076293945, 1.1319999694824219),
			RightUpperLeg: new THREE.Vector3(1.0230000019073486, 1.50600004196167, 1.0230000019073486),
			UpperTorso: new THREE.Vector3(1.0329999923706055, 1.309000015258789, 1.1399999856948853),
			Head: new THREE.Vector3(0.9419999718666077, 0.9419999718666077, 0.9419999718666077),
		},
		Rthro: {
			LeftFoot: new THREE.Vector3(1.4040000438690186, 0.953000009059906, 0.9309999942779541),
			LeftHand: new THREE.Vector3(1.3899999856948853, 0.9670000076293945, 1.2009999752044678),
			LeftLowerArm: new THREE.Vector3(1.121000051498413, 0.6809999942779541, 0.968000054359436),
			LeftLowerLeg: new THREE.Vector3(0.9779999852180481, 0.8140000104904175, 1.055999994277954),
			LeftUpperArm: new THREE.Vector3(1.121000051498413, 0.6809999942779541, 0.968000054359436),
			LeftUpperLeg: new THREE.Vector3(0.9779999852180481, 0.8140000104904175, 1.055999994277954),
			LowerTorso: new THREE.Vector3(1.0140000581741333, 0.8140000104904175, 0.9240000247955322),
			RightFoot: new THREE.Vector3(1.4040000438690186, 0.953000009059906, 0.9309999942779541),
			RightHand: new THREE.Vector3(1.3899999856948853, 0.9670000076293945, 1.2009999752044678),
			RightLowerArm: new THREE.Vector3(1.121000051498413, 0.6809999942779541, 0.968000054359436),
			RightLowerLeg: new THREE.Vector3(0.9779999852180481, 0.8140000104904175, 1.055999994277954),
			RightUpperArm: new THREE.Vector3(1.121000051498413, 0.6809999942779541, 0.968000054359436),
			RightUpperLeg: new THREE.Vector3(0.9779999852180481, 0.8140000104904175, 1.055999994277954),
			UpperTorso: new THREE.Vector3(1.0140000581741333, 0.8140000104904175, 0.9240000247955322),
			Head: new THREE.Vector3(1.600000023841858, 1.600000023841858, 1.600000023841858)
		},
		Proportion: {
			LeftFoot: new THREE.Vector3(0.9541984796524048, 0.8944543600082397, 0.8888888955116272),
			LeftHand: new THREE.Vector3(0.8888888359069824, 1, 0.8888888955116272),
			LeftLowerArm: new THREE.Vector3(0.8888888359069824, 0.9000899791717529, 0.8888888955116272),
			LeftLowerLeg: new THREE.Vector3(0.9541985392570496, 0.8635578751564026, 0.8888888955116272),
			LeftUpperArm: new THREE.Vector3(0.8888888359069824, 0.9000899791717529, 0.8888888955116272),
			LeftUpperLeg: new THREE.Vector3(0.9541985392570496, 0.9302325248718262, 0.8888888955116272),
			LowerTorso: new THREE.Vector3(0.9541985392570496, 0.7674597501754761, 0.8888888955116272),
			RightFoot: new THREE.Vector3(0.9541984796524048, 0.8944543600082397, 0.8888888955116272),
			RightHand: new THREE.Vector3(0.8888888359069824, 1, 0.8888888955116272),
			RightLowerArm: new THREE.Vector3(0.8888888359069824, 0.9000899791717529, 0.8888888955116272),
			RightLowerLeg: new THREE.Vector3(0.9541985392570496, 0.8635578751564026, 0.8888888955116272),
			RightUpperArm: new THREE.Vector3(0.8888888359069824, 0.9000899791717529, 0.8888888955116272),
			RightUpperLeg: new THREE.Vector3(0.9541985392570496, 0.9302325248718262, 0.8888888955116272),
			UpperTorso: new THREE.Vector3(0.8764241933822632, 0.9199632406234741, 0.8888888955116272),
			Head: new THREE.Vector3(0.9514747858047485, 1, 0.9514747858047485),
		}
	}
	
	const tempMatrix = new THREE.Matrix4()
	const tempMatrix2 = new THREE.Matrix4()
	const tempMatrix3 = new THREE.Matrix4()
	const tempVector = new THREE.Vector3()
	const tempVector2 = new THREE.Vector3()
	const tempEuler = new THREE.Euler()
	const tempQuatFacs = new THREE.Quaternion()

	/** FACS local delta (dynamic-head blink) for one bone; writes into outMat. */
	function fillRbxFacsBlinkDeltaMatrix(facs, boneName, facsW, outMat) {
		if(!facs || facsW <= 1e-4 || !facs.numPoses) {
			return false
		}
		const row = facs.boneIndexByName[boneName]
		if(row === undefined || row < 0) {
			return false
		}
		let cols = facs.blinkColumns
		if(!cols || cols.length === 0) {
			cols = []
			for(let c = 0; c < Math.min(facs.numPoses, 50); c++) {
				const nm = String(facs.columnNames[c] || "").toLowerCase()
				if(/blink|eyeclose|eyelid|eyes|squint/i.test(nm)) {
					cols.push(c)
				}
			}
		}
		if(cols.length === 0) {
			cols = [0]
		}
		let fx = 0
		let fy = 0
		let fz = 0
		let arx = 0
		let ary = 0
		let arz = 0
		const inv = 1 / cols.length
		for(const col of cols) {
			if(col < 0 || col >= facs.numPoses) {
				continue
			}
			const idx = row * facs.numPoses + col
			if(idx >= facs.px.length) {
				continue
			}
			fx += facs.px[idx] * inv
			fy += facs.py[idx] * inv
			fz += facs.pz[idx] * inv
			arx += facs.rx[idx] * inv
			ary += facs.ry[idx] * inv
			arz += facs.rz[idx] * inv
		}
		fx *= facsW
		fy *= facsW
		fz *= facsW
		const d2r = Math.PI / 180
		tempEuler.set(arx * d2r * facsW, ary * d2r * facsW, arz * d2r * facsW, "XYZ")
		tempQuatFacs.setFromEuler(tempEuler)
		outMat.compose(tempVector.set(fx, fy, fz), tempQuatFacs, tempVector2.set(1, 1, 1))
		return true
	}

	const clampNumber = (value, min, max, fallback) => {
		const n = Number(value)
		if(!Number.isFinite(n)) { return fallback }
		return Math.min(max, Math.max(min, n))
	}

	function normalizeWrapRequestScales(baseScales) {
		const width = clampNumber(baseScales?.width, 0.7, 1.0, 1)
		const height = clampNumber(baseScales?.height, 0.9, 1.05, 1)
		const head = clampNumber(baseScales?.head, 0.95, 1.0, 1)
		const bodyType = clampNumber(baseScales?.bodyType, 0, 1, 0)
		const proportion = clampNumber(baseScales?.proportion, 0, 1, 0)
		const depthRaw = Number(baseScales?.depth)
		const depthFallback = 0.5 + width / 2
		const depth = Number.isFinite(depthRaw)
			? clampNumber(depthRaw, 0.5, 1.0, depthFallback)
			: clampNumber(depthFallback, 0.5, 1.0, 1)

		return {
			width,
			height,
			depth,
			head,
			proportion,
			bodyType
		}
	}
	
	let compositeRenderer
	
	const invalidRenderMetaAssetIds = {}
	const invalidLayeredAssetIds = {}
	
	const skinnedWorld = new THREE.Matrix4()
	
	const objCache = {}
	
	class Avatar extends EventEmitter {
		constructor() {
			super()
			this.root = new THREE.Group()
			this.animator = new RBXAnimator()
			this.assets = []

			this.baseLoadedPromise = createDeferredPromise()
			
			this.activeMaterials = []
			this.sortedJointsArray = []
			this.accessories = []
			this.attachments = {}
			this.attachmentsByName = {}
			this.joints = {}
			this.parts = {}

			this.playerType = null
			this.hipHeight = 2
			
			this.offset = new THREE.Vector3()
			this.offsetRot = new THREE.Euler()
			this._headFollowWorldDelta = new THREE.Matrix4()
			this._headFollowBindMatrix = new THREE.Matrix4()
			this._headFollowCurrentMatrix = new THREE.Matrix4()
			this._headFollowHatBindWorld = new THREE.Matrix4()
			this._headFollowHasHatBindWorld = false
			this._headFollowHeadBindWorld = new THREE.Matrix4()
			this._headFollowHasHeadBindWorld = false
			this._lastHeadFollowSource = null
			this._lastHeadFollowAttachmentName = null
			this._syntheticHeadHatAttachment = null
			this._hasEquippedGear = false
			this._facsBlinkWeight = 0

			this.scales = {
				width: 1,
				height: 1,
				depth: 1,
				head: 1,
				proportion: 0,
				bodyType: 0
			}
			
			this.bodyColors = {
				head: "#A3A2A5",
				torso: "#A3A2A5",
				leftArm: "#A3A2A5",
				rightArm: "#A3A2A5",
				leftLeg: "#A3A2A5",
				rightLeg: "#A3A2A5"
			}
			
			if(!compositeRenderer) {
				compositeRenderer = new THREE.WebGLRenderer({ alpha: true })
			}
		}

		init() {
			if(this.hasInit) { throw new Error("Avatar has already been initialized") }
			this.hasInit = true

			const sources = this.sources = {
				pants: new MergeSource(),
				shirt: new MergeSource(),
				tshirt: new MergeSource(),
				face: new MergeSource(),
				
				bodyColors: {
					R6: new MergeSource(ctx => {
						ctx.fillStyle = this.bodyColors.torso
						ctx.fillRect(0, 0, 192, 448)
						ctx.fillRect(194, 322, 272, 76)
						ctx.fillRect(272, 401, 148, 104)
				
						ctx.fillStyle = this.bodyColors.rightArm
						ctx.fillRect(200, 0, 192, 320)
						ctx.fillRect(420, 400, 148, 104)
						ctx.fillRect(758, 322, 76, 76)
						ctx.fillRect(898, 322, 76, 76)
				
						ctx.fillStyle = this.bodyColors.leftArm
						ctx.fillRect(400, 0, 192, 320)
						ctx.fillRect(568, 400, 148, 104)
						ctx.fillRect(828, 322, 76, 76)
						ctx.fillRect(194, 394, 76, 76)
				
						ctx.fillStyle = this.bodyColors.rightLeg
						ctx.fillRect(600, 0, 192, 320)
						ctx.fillRect(716, 400, 148, 104)
						ctx.fillRect(466, 322, 76, 76)
						ctx.fillRect(610, 322, 76, 76)
				
						ctx.fillStyle = this.bodyColors.leftLeg
						ctx.fillRect(800, 0, 192, 320)
						ctx.fillRect(864, 400, 148, 104)
						ctx.fillRect(542, 322, 76, 76)
						ctx.fillRect(684, 322, 76, 76)
					}),
					
					head: MergeSource.fromHex("#A3A2A5"),
					torso: MergeSource.fromHex("#A3A2A5"),
					leftArm: MergeSource.fromHex("#A3A2A5"),
					leftLeg: MergeSource.fromHex("#A3A2A5"),
					rightArm: MergeSource.fromHex("#A3A2A5"),
					rightLeg: MergeSource.fromHex("#A3A2A5")
				},
				
				pbr: {},
				base: {}
			}
			
			const textures = this.textures = {
				pbr: {}
			}
			
			const composites = this.composites = {
				r6: new RBXComposites.R6Composite(sources),
				torso: new RBXComposites.R15TorsoComposite(sources),
				leftArm: new RBXComposites.R15LeftArmComposite(sources),
				leftLeg: new RBXComposites.R15LeftLegComposite(sources),
				rightArm: new RBXComposites.R15RightArmComposite(sources),
				rightLeg: new RBXComposites.R15RightLegComposite(sources)
			}
			
			sources.face.defaultImage = RBXAvatar.LocalAssets[`res/previewer/face.png`]
			
			for(const name of ["Head", ...R6BodyPartNames]) {
				sources.base[name] = new MergeSource()
				sources[name] = new MergeSource()
				
				textures[name] =
					name === "Head" ? new MergeTexture(256, 256, sources.bodyColors.head, sources.base[name], sources[name], sources.face)
					: new MergeTexture(1024, 512, sources.bodyColors.R6, sources.base[name], composites.r6, sources[name])
			}

			for(const name of R15BodyPartNames) {
				const limb = name.replace(/\s|Lower|Upper/g, "").replace(/Hand|Foot/, x => ({ Hand: "Arm", Foot: "Leg" })[x]).replace(/^./, x => x.toLowerCase())
				const composite = composites[limb]
				
				sources[name] = new MergeSource()
				textures[name] = new MergeTexture(composite.canvas.width, composite.canvas.height, sources.bodyColors[limb], composite, sources[name])
			}
			
			for(const name of ["Head", ...R6BodyPartNames, ...R15BodyPartNames]) {
				const limb = name.replace(/\s|Lower|Upper/g, "").replace(/Hand|Foot/, x => ({ Hand: "Arm", Foot: "Leg" })[x]).replace(/^./, x => x.toLowerCase())
				
				sources.pbr[name] = new MergeSource()
				textures.pbr[name] = new MergeTexture(1024, 1024, sources.bodyColors[limb], sources.pbr[name])
			}
			
			//

			const loaders = []

			loaders.push(
				RBXAvatarRigs.load().then(() => {
					this.shouldRefreshRig = true
				})
			)
			
			for(const composite of Object.values(this.composites)) {
				loaders.push(...composite.loaders)
			}
			
			if(this.bodyColors) {
				this.setBodyColors(this.bodyColors)
			}
			
			Promise.all(loaders).then(() => this.baseLoadedPromise.$resolve())
		}

		async waitForAppearance() {
			await this.baseLoadedPromise
			let finalCheck = false
			
			while(true) {
				let loaded = true
				
				for(const asset of this.assets) {
					if(!asset.enabled) { continue }
					
					if(!asset.get(this.playerType).loaded) {
						loaded = false
						break
					}
				}
				
				if(loaded) {
					if(!finalCheck) {
						finalCheck = true
						this.update() // force load new accessories, if necessary
						continue
					}
					
					break
				}
				
				finalCheck = false
				await new Promise(resolve => requestAnimationFrame(resolve))
			}
		}

		startLoadingAssets() {
			for(const asset of this.assets) {
				asset.load()
			}
		}
		
		addAsset(assetId, assetTypeId, meta = null) {
			const asset = new AvatarAsset(assetId, assetTypeId, meta)
			this.assets.push(asset)

			asset.on("update", () => {
				this.shouldRefreshBodyParts = true
			})

			asset.once("remove", () => {
				this.assets.splice(this.assets.indexOf(asset), 1)
				this.shouldRefreshBodyParts = true
			})

			this.shouldRefreshBodyParts = true
			return asset
		}
		
		updateBones(obj, acc) {
			const isLayeredAccessory = obj.rbxLayered?.wrapLayer
			
			for(const joint of this.sortedJointsArray) {
				if(isLayeredAccessory) {
					joint.skinnedPoseMatrix.multiplyMatrices(joint.part0.skinnedPoseMatrix, joint.bakedC0)
					joint.part1.skinnedPoseMatrix.multiplyMatrices(joint.skinnedPoseMatrix, joint.bakedC1Inverse)
				} else {
					if(obj.rbxBodypart) {
						joint.skinnedPoseMatrix.multiplyMatrices(joint.part0.skinnedPoseMatrix, joint.C0)
						joint.part1.skinnedPoseMatrix.multiplyMatrices(joint.skinnedPoseMatrix, joint.C1Inverse)
					}
					
					joint.skinnedNoScale
						.multiplyMatrices(joint.part0.skinnedNoScale, scalePosition(tempMatrix.copy(joint.C0), obj.rbxScaleMod))
						.multiply(joint.transform)
					
					joint.part1.skinnedNoScale
						.multiplyMatrices(joint.skinnedNoScale, scalePosition(tempMatrix.copy(joint.C1Inverse), obj.rbxScaleMod))
				}
			}
			
			if(acc?.parent && acc.bakedCFrame) {
				obj.skinnedPoseMatrix.multiplyMatrices(acc.parent.skinnedPoseMatrix, acc.bakedCFrame)
				obj.skinnedNoScale.multiplyMatrices(acc.parent.skinnedNoScale, acc.bakedCFrame)
			}
			
			if(!isLayeredAccessory) {
				skinnedWorld
					.copy(obj.matrix).invert()
					.multiply(obj.matrixNoScale)
					.multiply(tempMatrix.copy(obj.skinnedNoScale).invert())
			}
			
			for(const bone of obj.rbxBones) {
				const joint = this.joints[bone.name]
				
				if(!joint || bone.count === 0) {
					const facsW = this._facsBlinkWeight
					if(
						!isLayeredAccessory
						&& obj.rbxBodypart
						&& obj.rbxFacs
						&& bone.count > 0
						&& fillRbxFacsBlinkDeltaMatrix(obj.rbxFacs, bone.name, facsW, tempMatrix)
					) {
						tempMatrix2.copy(bone.cframe).multiply(tempMatrix)
						bone.matrixWorld.multiplyMatrices(skinnedWorld, tempMatrix2)
						bone.inverse.copy(tempMatrix2).invert()
						scalePosition(bone.inverse, obj.rbxScaleMod).scale(obj.scale)
						continue
					}
					bone.matrixWorld.identity()
					bone.inverse.identity()
					continue
				}
				
				if(isLayeredAccessory) {
					bone.matrixWorld.copy(obj.matrix).invert().multiply(joint.matrixNoScale)
					bone.inverse.copy(obj.skinnedPoseMatrix).invert().multiply(joint.skinnedPoseMatrix).invert()
					
					// scale a bit with parent so it looks better when changing scales
					const initialScale = obj.rbxLayered.initialScale
					
					if(initialScale && acc?.parent?.rbxScaleMod) {
						bone.inverse.scale(tempVector.copy(acc.parent.rbxScaleMod).divide(initialScale))
					}
					
				} else if(obj.rbxBodypart) {
					bone.matrixWorld.multiplyMatrices(skinnedWorld, joint.skinnedNoScale)
					bone.inverse.copy(obj.skinnedPoseMatrix).invert().multiply(joint.skinnedPoseMatrix).invert()
					
					scalePosition(bone.inverse, obj.rbxScaleMod).scale(obj.scale)
					
					if(!isLayeredAccessory && obj.rbxFacs && fillRbxFacsBlinkDeltaMatrix(obj.rbxFacs, bone.name, this._facsBlinkWeight, tempMatrix)) {
						tempMatrix3.multiplyMatrices(joint.skinnedNoScale, tempMatrix)
						bone.matrixWorld.multiplyMatrices(skinnedWorld, tempMatrix3)
						bone.inverse.copy(obj.skinnedPoseMatrix).invert().multiply(joint.skinnedPoseMatrix).invert()
						scalePosition(bone.inverse, obj.rbxScaleMod).scale(obj.scale)
					}
					
				} else {
					bone.matrixWorld.multiplyMatrices(skinnedWorld, joint.skinnedNoScale)
					bone.inverse.copy(bone.cframe).invert()
					
					scalePosition(bone.inverse, obj.rbxScaleMod).scale(obj.scale)
					
					if(!isLayeredAccessory && obj.rbxFacs && fillRbxFacsBlinkDeltaMatrix(obj.rbxFacs, bone.name, this._facsBlinkWeight, tempMatrix)) {
						tempMatrix3.multiplyMatrices(joint.skinnedNoScale, tempMatrix)
						bone.matrixWorld.multiplyMatrices(skinnedWorld, tempMatrix3)
						bone.inverse.copy(bone.cframe).invert()
						scalePosition(bone.inverse, obj.rbxScaleMod).scale(obj.scale)
					}
				}
			}
		}
		
		update() {
			if(this.shouldRefreshRig) {
				this._refreshRig()
			}

			if(this.shouldRefreshBodyParts) {
				this._refreshBodyParts()
			}
			
			if(this.shouldRefreshLayeredClothing) {
				this._refreshLayeredClothing()
			}
			
			let hasInvalidLayeredClothing = this.layeredFinishedRequest?.failedToResolveAllAccessories
			
			this.animator.update()
			{
				const faceMotionOn = globalThis.BTR_ENABLE_FACE_FACS_MOTION !== false
				const t = performance.now() / 1000
				/* ~every 3.8s a slightly longer blink so FACS heads are easier to notice in the launcher preview. */
				const cycle = t % 3.8
				let w = 0
				if(faceMotionOn && cycle >= 2.55 && cycle <= 3.35) {
					const u = (cycle - 2.55) / 0.8
					w = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * 1.12
					if(w > 1) { w = 1 }
				}
				this._facsBlinkWeight = w
			}
			const debugVisionEnabled = !!globalThis.BTR_DEBUG_VISION
			
			this.root.position.copy(this.offset)
			// this.root.rotation.copy(this.offsetRot)
			
			const rootPart = this.parts.HumanoidRootPart
			rootPart?.matrixNoScale.makeRotationFromEuler(this.offsetRot).setPosition(0, this.hipHeight + (rootPart?.rbxSize[1] ?? 0) / 2, 0)
			
			// Update joints
			const hasEquippedGear = !!this._hasEquippedGear
			for(const joint of this.sortedJointsArray) {
				const transform = this.animationsDisabled ? null : this.animator.getJointTransform(joint.part0.name, joint.part1.name)
				
				if(transform) {
					joint.transform.compose(transform.position, transform.quaternion, tempVector.set(1, 1, 1))
				} else {
					joint.transform.identity()
				}
				
				if(this.playerType === "R15" && joint.part1.name === "LowerTorso") {
					scalePosition(joint.transform, tempVector.setScalar(this.hipHeight / 2))
				}

				if(hasEquippedGear) {
					const isR15RightShoulder = joint.part0?.name === "UpperTorso" && joint.part1?.name === "RightUpperArm"
					const isR6RightShoulder = joint.part0?.name === "Torso" && joint.part1?.name === "Right Arm"
					if(isR15RightShoulder) {
						// R15 shoulder axis differs from R6; use X rotation to point arm forward.
						joint.transform.multiply(tempMatrix.makeRotationFromEuler(tempEuler.set(Math.PI / 2, 0, 0, "XYZ")))
					} else if(isR6RightShoulder) {
						// R6 baseline hold: shoulder points tool forward.
						joint.transform.multiply(tempMatrix.makeRotationFromEuler(tempEuler.set(0, 0, Math.PI / 2, "XYZ")))
					}
				}
				
				joint.matrixNoScale.multiplyMatrices(joint.part0.matrixNoScale, joint.bakedC0).multiply(joint.transform)
				joint.part1.matrixNoScale.multiplyMatrices(joint.matrixNoScale, joint.bakedC1Inverse)
			}
			
			// Update parts
			for(const part of Object.values(this.parts)) {
				part.matrix.copy(part.matrixNoScale).scale(part.scale)
				part.matrixWorldNeedsUpdate = true
				
				if(part.isMesh && part.material) {
					const baseOpacity = part.rbxBodypart?.opacity ?? 1
					const targetOpacity = debugVisionEnabled ? Math.min(baseOpacity, 0.5) : baseOpacity
					const targetTransparent = debugVisionEnabled
						|| targetOpacity < 1
						|| part.rbxBodypart?.pbrAlphaMode === 1
					
					if(part.material.opacity !== targetOpacity || part.material.transparent !== targetTransparent) {
						part.material.opacity = targetOpacity
						part.material.transparent = targetTransparent
						part.material.needsUpdate = true
					}
				}
			}
			
			// Update accessories
			this.hasInvalidAutoSkinnedAccessories = false
			const wrapHeightScale = Number(this.wrapScales?.height ?? this.scales?.height ?? 1)
			const dynamicHeadActive = hasDynamicHeadEquipped(this)
			const liveHeadGap = getHeadGap(wrapHeightScale, dynamicHeadActive) + 0.02
			let hasHeadFollowDelta = false
			let headFollowSource = "none"
			const headFollowAttachmentInfo = this._getHeadFollowAttachmentInfo()
			const headFollowAttachment = headFollowAttachmentInfo?.attachment
			const headFollowAttachmentName = headFollowAttachmentInfo?.attachmentName || null
			const attachmentHasMatrices = !!headFollowAttachment?.parent?.matrixNoScale && !!headFollowAttachment?.bakedCFrame
			if(attachmentHasMatrices) {
				this._headFollowCurrentMatrix.multiplyMatrices(headFollowAttachment.parent.matrixNoScale, headFollowAttachment.bakedCFrame)
				
				if(headFollowAttachment.parent.layeredMatrix) {
					this._headFollowBindMatrix.multiplyMatrices(headFollowAttachment.parent.layeredMatrix, headFollowAttachment.bakedCFrame)
					this._headFollowHatBindWorld.copy(this._headFollowBindMatrix)
					this._headFollowHasHatBindWorld = true
				} else if(this._headFollowHasHatBindWorld) {
					this._headFollowBindMatrix.copy(this._headFollowHatBindWorld)
				} else {
					// First valid frame without layered bind data: use current hat attachment world pose
					// as bind reference so following frames still track HatAttachment motion.
					this._headFollowBindMatrix.copy(this._headFollowCurrentMatrix)
					this._headFollowHatBindWorld.copy(this._headFollowCurrentMatrix)
					this._headFollowHasHatBindWorld = true
				}
				
				this._headFollowWorldDelta
					.copy(this._headFollowCurrentMatrix)
					.multiply(tempMatrix.copy(this._headFollowBindMatrix).invert())
				hasHeadFollowDelta = true
				headFollowSource = "headAttachment"
			}
			
			if(!hasHeadFollowDelta) {
				const headBindMatrix = this.parts?.Head?.layeredMatrix
				const headCurrentMatrix = this.parts?.Head?.matrixNoScale
				if(headCurrentMatrix) {
				if(headBindMatrix) {
					this._headFollowBindMatrix.copy(headBindMatrix)
					this._headFollowHeadBindWorld.copy(this._headFollowBindMatrix)
					this._headFollowHasHeadBindWorld = true
				} else if(this._headFollowHasHeadBindWorld) {
					this._headFollowBindMatrix.copy(this._headFollowHeadBindWorld)
				} else {
					this._headFollowBindMatrix.copy(headCurrentMatrix)
					this._headFollowHeadBindWorld.copy(headCurrentMatrix)
					this._headFollowHasHeadBindWorld = true
				}
				this._headFollowCurrentMatrix.copy(headCurrentMatrix)

				this._headFollowWorldDelta
					.copy(headCurrentMatrix)
					.multiply(tempMatrix.copy(this._headFollowBindMatrix).invert())
					hasHeadFollowDelta = true
					headFollowSource = headFollowAttachment ? "headPartFallback" : "headPart"
				}
			}
			
			if(globalThis.BTR_WRAP_DEBUG && (this._lastHeadFollowSource !== headFollowSource || this._lastHeadFollowAttachmentName !== headFollowAttachmentName)) {
				const hasHeadPart = !!this.parts?.Head
				if(!hasHeadPart && headFollowSource === "none") {
					// Skip noisy preload state; head/attachments are not ready yet.
				} else {
				this._lastHeadFollowSource = headFollowSource
				this._lastHeadFollowAttachmentName = headFollowAttachmentName
				const debugPayload = {
					source: headFollowSource,
					hasHatAttachment: !!headFollowAttachmentInfo?.attachment && /hatattachment/i.test(String(headFollowAttachmentName || "")),
					attachmentName: headFollowAttachmentName,
					availableHeadAttachments: headFollowAttachmentInfo?.availableHeadAttachmentNames || undefined,
					hasHeadPart: hasHeadPart,
					attachmentHasMatrices: attachmentHasMatrices
				}
				console.log("[wrap debug] head follow source", debugPayload, JSON.stringify(debugPayload))
				}
			}
			
			for(const acc of this.accessories) {
				if(!acc.parent) { continue }
				
				if(acc.obj?.material) {
					const baseOpacity = acc.opacity ?? 1
					const targetOpacity = debugVisionEnabled ? Math.min(baseOpacity, 0.5) : baseOpacity
					const targetTransparent = debugVisionEnabled
						|| targetOpacity < 1
						|| acc.pbrAlphaMode === 1
					
					if(acc.obj.material.opacity !== targetOpacity || acc.obj.material.transparent !== targetTransparent) {
						acc.obj.material.opacity = targetOpacity
						acc.obj.material.transparent = targetTransparent
						acc.obj.material.needsUpdate = true
					}
				}

				acc.obj.matrixNoScale.multiplyMatrices(acc.parent.matrixNoScale, acc.bakedCFrame)

				clampDynamicHoodAboveHead(acc, this, acc.obj.matrixNoScale, wrapHeightScale, dynamicHeadActive, false)

				// Apply live hood offset at render time (client-side only).
				if(shouldApplyHeadGapOffset(acc, acc.parent, wrapHeightScale, dynamicHeadActive)) {
					acc.obj.matrixNoScale.elements[13] -= liveHeadGap
				}

				let scale = acc.obj.scale
				
				if(acc.wrapLayer?.autoSkin) {
					const initialScale = acc.obj.rbxLayered?.initialScale
					
					if(initialScale) {
						scale = tempVector.copy(acc.parent.rbxScaleMod).divide(initialScale)
					}
				}

				if(hasHeadFollowDelta) {
					// Pass current head world matrix so anchor-aware follow can lock tall pieces (antennae) to the head origin.
					applyLayeredHeadFollowFallback(acc, this._headFollowWorldDelta, this._headFollowCurrentMatrix, scale)
				}
				
				acc.obj.matrix.copy(acc.obj.matrixNoScale).scale(scale)
				acc.obj.matrixWorldNeedsUpdate = true

				if(acc.effects?.length && globalThis.RBXEffects) {
					acc.effectsRuntime ??= new globalThis.RBXEffects.AccessoryEffects(acc.effects, this.root, {})
					tempMatrix3.copy(acc.obj.matrixNoScale)
					if(acc.offset) {
						tempMatrix3.multiply(tempMatrix2.makeTranslation(-acc.offset[0], -acc.offset[1], -acc.offset[2]))
					}
					acc.effectsRuntime.update(tempMatrix3, (scale.x + scale.y + scale.z) / 3, acc.obj.visible)
				}
			}
			
			// Update bones
			for(const part of Object.values(this.parts)) {
				if(part.rbxBones) {
					this.updateBones(part)
					part.skeleton.btr_apply()
				}
			}
			
			for(const acc of this.accessories) {
				if(acc.parent && acc.obj.rbxBones) {
					this.updateBones(acc.obj, acc)
					acc.obj.skeleton.btr_apply()
				}
			}
			
			// Update composites
			const activeComposites = this.playerType === "R6"
				? [this.composites.r6]
				: [this.composites.torso, this.composites.leftArm, this.composites.rightArm, this.composites.leftLeg, this.composites.rightLeg]

			for(const comp of activeComposites) {
				if(comp.needsUpdate) {
					comp.update(compositeRenderer)
				}
			}
			
			// Update materials
			for(const material of this.activeMaterials) {
				if(!material) { continue }
				
				for(const key of ["map", "normalMap", "roughnessMap", "metalnessMap"]) {
					const texture = material[key]
					
					if(texture instanceof MergeTexture) {
						if(texture.btrNeedsUpdate) {
							texture.update()
						}
					}
				}
			}
			
			// update hasInvalidLayeredClothing
			
			if(!!this.hasInvalidLayeredClothing !== !!hasInvalidLayeredClothing) {
				this.hasInvalidLayeredClothing = hasInvalidLayeredClothing
				this.trigger("hasInvalidLayeredClothingChanged", hasInvalidLayeredClothing)
			}
		}

		resetScales() {
			this.setScales({
				width: 1,
				height: 1,
				depth: 1,
				head: 1,
				proportion: 0,
				bodyType: 0
			})
		}

		setScales(scales) {
			let changed = false
			const wrapSyncEnabled = globalThis.BTR_SYNC_WRAP_SCALES_WITH_RIG !== false

			for(const name of Object.keys(this.scales)) {
				if(name in scales) {
					const next = Number(scales[name])
					if(!Number.isFinite(next)) { continue }
					if(this.scales[name] !== next) {
						this.scales[name] = next
						changed = true
					}

					if(wrapSyncEnabled && this.wrapScales && Object.prototype.hasOwnProperty.call(this.wrapScales, name)) {
						this.wrapScales[name] = next
					}
				}
			}

			// Roblox width slider drives depth in lockstep.
			if(Object.prototype.hasOwnProperty.call(scales || {}, "width")
				&& !Object.prototype.hasOwnProperty.call(scales || {}, "depth")) {
				const linkedDepth = clampNumber(0.5 + Number(this.scales.width) / 2, 0.5, 1.0, 1)
				if(this.scales.depth !== linkedDepth) {
					this.scales.depth = linkedDepth
					changed = true
				}
				if(wrapSyncEnabled && this.wrapScales) {
					this.wrapScales.depth = linkedDepth
				}
			}

			if(wrapSyncEnabled && !this.wrapScales) {
				this.wrapScales = { ...this.scales }
			}

			if(!changed) { return }
			this.shouldRefreshBodyParts = true
			this.shouldRefreshLayeredClothing = true
		}

		setBodyColors(bodyColors) {
			this.bodyColors = bodyColors
			
			this.sources?.bodyColors.R6.update()
			
			for(const [key, value] of Object.entries(this.bodyColors)) {
				this.sources?.bodyColors[key].setHex(value)
			}
		}

		setPlayerType(playerType) {
			if(this.playerType === playerType) { return }
			this.playerType = playerType
			this.shouldRefreshRig = true
		}

		getScaleMod(partName, scaleType, partScaleType, result) { // Only use partScaleType with accessories! C:
			if(!result) { result = new THREE.Vector3() }
			
			if(this.playerType !== "R15") {
				return result.set(1, 1, 1)
			}

			if(partName === "Head") {
				result.setScalar(this.scales.head)
			} else {
				result.set(this.scales.width, this.scales.height, this.scales.depth)
			}

			const defaultMod = ScaleMods.Default[partName]

			if(!defaultMod) {
				return result
			}

			const rthroMod = ScaleMods.Rthro[partName]
			const propMod = ScaleMods.Proportion[partName]

			const startScale = new THREE.Vector3()
			const endScale = new THREE.Vector3()

			if(scaleType === "ProportionsNormal") {
				startScale.copy(rthroMod)
				endScale.set(1, 1, 1).lerp(propMod, this.scales.proportion)

				if(partScaleType && partScaleType !== "ProportionsNormal" && partScaleType !== "ProportionsSlender") {
					endScale.multiply(tempVector.copy(rthroMod).multiply(defaultMod))
				}
			} else if(scaleType === "ProportionsSlender") {
				startScale.copy(rthroMod).multiply(tempVector.set(1, 1, 1).divide(propMod))
				endScale.set(1, 1, 1).divide(propMod).lerp(tempVector.set(1, 1, 1), this.scales.proportion)

				if(partScaleType && partScaleType !== "ProportionsNormal" && partScaleType !== "ProportionsSlender") {
					endScale.multiply(tempVector.copy(rthroMod).multiply(defaultMod))
				}
			} else {
				startScale.set(1, 1, 1)
				endScale.copy(defaultMod).multiply(tempVector.set(1, 1, 1).lerp(propMod, this.scales.proportion))

				if(partScaleType && (partScaleType === "ProportionsNormal" || partScaleType === "ProportionsSlender")) {
					endScale.divide(tempVector.copy(rthroMod).multiply(defaultMod))
				}
			}

			result.multiply(startScale.lerp(endScale, this.scales.bodyType))
			
			return result
		}

		_getHeadFollowAttachmentInfo() {
			const attachmentsByName = this.attachmentsByName || {}
			const attachments = this.attachments || {}
			const normalize = name => String(name || "").toLowerCase()
			const availableHeadAttachmentNames = []

			const collectHeadByName = name => {
				const exact = attachmentsByName[name]
				if(Array.isArray(exact)) {
					const head = exact.find(att => att?.parent?.name === "Head")
					if(head) { return head }
				}

				const needle = normalize(name)
				for(const [key, candidates] of Object.entries(attachmentsByName)) {
					if(normalize(key) !== needle) { continue }
					if(Array.isArray(candidates)) {
						const head = candidates.find(att => att?.parent?.name === "Head")
						if(head) { return head }
					}
				}

				const legacyExact = attachments[name]
				if(legacyExact?.parent?.name === "Head") { return legacyExact }

				for(const [key, candidate] of Object.entries(attachments)) {
					if(normalize(key) === needle && candidate?.parent?.name === "Head") {
						return candidate
					}
				}

				return null
			}

			for(const name of HeadFollowPreferredAttachmentNames) {
				const attachment = collectHeadByName(name)
				if(attachment) {
					return {
						attachment: attachment,
						attachmentName: name,
						availableHeadAttachmentNames: null
					}
				}
			}

			const anyHeadCandidates = []
			for(const [name, candidates] of Object.entries(attachmentsByName)) {
				if(!Array.isArray(candidates)) { continue }
				const head = candidates.find(att => att?.parent?.name === "Head")
				if(!head) { continue }
				availableHeadAttachmentNames.push(name)
				anyHeadCandidates.push({ name, attachment: head })
			}

			for(const [name, candidate] of Object.entries(attachments)) {
				if(candidate?.parent?.name !== "Head") { continue }
				if(!availableHeadAttachmentNames.includes(name)) {
					availableHeadAttachmentNames.push(name)
				}
			}

			const semanticCandidate = anyHeadCandidates.find(row => /hat|hair|face|neck/i.test(row.name))
			const fallbackCandidate = semanticCandidate || anyHeadCandidates[0] || null
			if(fallbackCandidate) {
				return {
					attachment: fallbackCandidate.attachment,
					attachmentName: fallbackCandidate.name,
					availableHeadAttachmentNames: availableHeadAttachmentNames
				}
			}

			const headPart = this.parts?.Head
			if(headPart) {
				if(!this._syntheticHeadHatAttachment || this._syntheticHeadHatAttachment.parent !== headPart) {
					const syntheticCFrame = new THREE.Matrix4().identity()
					this._syntheticHeadHatAttachment = {
						origCFrame: syntheticCFrame.clone(),
						cframe: syntheticCFrame.clone(),
						bakedCFrame: syntheticCFrame.clone(),
						parent: headPart,
						name: "HatAttachment"
					}
				}

				return {
					attachment: this._syntheticHeadHatAttachment,
					attachmentName: "HatAttachment(synthetic)",
					availableHeadAttachmentNames: availableHeadAttachmentNames
				}
			}

			return {
				attachment: null,
				attachmentName: null,
				availableHeadAttachmentNames: availableHeadAttachmentNames
			}
		}

		_refreshRig() {
			if(!RBXAvatarRigs.loaded) { return }
			this.shouldRefreshRig = false
			this._headFollowHasHatBindWorld = false
			this._headFollowHasHeadBindWorld = false
			this._syntheticHeadHatAttachment = null
			
			//
			
			const recDispose = tar => {
				if(tar.isMesh) {
					if(tar.geometry) { tar.geometry.dispose() }
					if(tar.material) { tar.material.dispose() }
				}
				
				for(const child of tar.children) {
					recDispose(child)
				}
			}
			
			for(let i = this.root.children.length; i--;) {
				const child = this.root.children[i]
				recDispose(child)
				this.root.remove(child)
			}
			
			//
			
			this.sortedJointsArray = []
			
			const attachments = this.attachments = {}
			const attachmentsByName = this.attachmentsByName = {}
			const joints = this.joints = {}
			const parts = this.parts = {}

			const CreateModel = (tree, parentJoint) => {
				let obj
				
				if(tree.name !== "HumanoidRootPart") {
					obj = new THREE.SkinnedMesh(undefined, new THREE.MeshStandardMaterial({ map: this.textures[tree.name], transparent: false }))
					obj.isSkinnedMesh = false
					obj.bindMode = "detached"
					obj.frustumCulled = false
					obj.castShadow = true
				} else {
					obj = new THREE.Group()
				}
				
				obj.matrixAutoUpdate = false
				obj.name = tree.name
				
				// Custom stuff
				obj.rbxDefaultBodypart = {
					meshId: tree.meshId,
					wrapTarget: tree.wrapTarget
				}
				
				obj.rbxBodypart = obj.rbxDefaultBodypart
				obj.rbxOrigSize = tree.origSize
				obj.rbxScaleMod = new THREE.Vector3(1, 1, 1)
				
				obj.layeredMatrix = new THREE.Matrix4()
				obj.matrixNoScale = new THREE.Matrix4()
				obj.skinnedNoScale = new THREE.Matrix4()
				obj.skinnedPoseMatrix = new THREE.Matrix4()
				//
				
				this.root.add(obj)
				parts[tree.name] = obj
				
				for(const [name, cframe] of Object.entries(tree.attachments)) {
					const att = {
						origCFrame: cframe,
						cframe: cframe.clone(),
						bakedCFrame: cframe.clone(),
						parent: obj,
						name: name
					}
					attachments[name] = att
					;(attachmentsByName[name] = attachmentsByName[name] || []).push(att)
				}

				for(const child of tree.children) {
					const joint = joints[child.name] = {
						origC0: child.C0,
						origC1: child.C1,
						
						C0: child.C0.clone(),
						C1Inverse: child.C1.clone().invert(),
						
						bakedC0: child.C0.clone(),
						bakedC1Inverse: child.C1.clone().invert(),
						
						transform: new THREE.Matrix4(),
						
						layeredMatrix: new THREE.Matrix4(),
						matrixNoScale: new THREE.Matrix4(),
						skinnedNoScale: new THREE.Matrix4(),
						skinnedPoseMatrix: new THREE.Matrix4(),
						
						parent: parentJoint,
						name: child.JointName
					}
					
					const childObj = CreateModel(child, joint)
					
					joint.part0 = obj
					joint.part1 = childObj
					
					this.sortedJointsArray.push(joint)
				}

				return obj
			}

			if(this.playerType === "R6" && RBXAvatarRigs.R6Tree) {
				CreateModel(RBXAvatarRigs.R6Tree)
			} else if(this.playerType === "R15" && RBXAvatarRigs.R15Tree) {
				CreateModel(RBXAvatarRigs.R15Tree)
			}
			
			this.sortedJointsArray.reverse()
			this._refreshBodyParts()
		}

		_refreshBodyParts() {
			if(!RBXAvatarRigs.loaded) { return }
			
			this.shouldRefreshBodyParts = false
			this.activeMaterials = []
			this._headFollowHasHatBindWorld = false
			this._headFollowHasHeadBindWorld = false
			this._syntheticHeadHatAttachment = null
			
			const attachmentOverride = {}
			const clothingOverride = {}
			const bodypartOverride = {}
			const accessories = {}
			const assets = []
			
			for(const asset of this.assets) {
				if(!asset.enabled) { continue }
				
				const state = asset.load(this.playerType)
				
				if(state.loaded) {
					asset.lastIndex = assets.length
					assets.push(asset)
				}
			}

			assets.sort((a, b) => (a.priority === b.priority ? a.lastIndex - b.lastIndex : a.priority - b.priority))
			
			for(const asset of assets) {
				const state = asset.get(this.playerType)
				if(!state) { continue }
				
				for(const bodypart of state.bodyparts) {
					bodypartOverride[bodypart.target] = bodypart
				}
				
				for(const acc of state.accessories) {
					accessories[asset.id] = acc
				}
				
				for(const cloth of state.clothing) {
					clothingOverride[cloth.target] = cloth.texId
				}
			}
			
			// Update clothing
			for(const name of ["shirt", "pants", "tshirt", "face"]) {
				const source = this.sources[name]
				let texId = clothingOverride[name] || source.defaultImage || ""

				/* Head.disableFace suppresses the *default* face texture on dynamic/NoFace meshes; if the user
				 * equipped classic Face (18), clothingOverride.face must still win or R6 shows face.png smile. */
				if(name === "face" && bodypartOverride.Head?.disableFace && !clothingOverride.face) {
					texId = ""
				}
				
				if(source.rbxTexId !== texId) {
					source.rbxTexId = texId
					source.setImage(null)
					
					if(texId) {
						AssetCache.loadImage(true, texId, img => {
							if(source.rbxTexId === texId) {
								source.setImage(img)
							}
						})
					}
				}
			}
			
			// Update attachments
			if(this.playerType === "R15") {
				for(const bodypart of Object.values(bodypartOverride)) {
					for(const att of bodypart.attachments) {
						const override = attachmentOverride[att.part] = attachmentOverride[att.part] || {}
						override[att.target] = att
					}
				}

				// Ensure attachments from bodypart overrides exist on the rig even if base rig lacks them.
				for(const [partName, overrides] of Object.entries(attachmentOverride)) {
					const parent = this.parts?.[partName]
					if(!parent || !overrides) { continue }

					for(const [attName, override] of Object.entries(overrides)) {
						if(!override?.cframe) { continue }

						const candidates = this.attachmentsByName?.[attName] || []
						const alreadyExists = candidates.some(att => att?.parent === parent)
						if(alreadyExists) { continue }

						const cframe = override.cframe.clone ? override.cframe.clone() : new THREE.Matrix4().copy(override.cframe)
						const att = {
							origCFrame: cframe.clone(),
							cframe: cframe.clone(),
							bakedCFrame: cframe.clone(),
							parent: parent,
							name: attName
						}

						this.attachments[attName] = att
						;(this.attachmentsByName[attName] = this.attachmentsByName[attName] || []).push(att)
					}
				}
			}
			
			for(const [attName, candidates] of Object.entries(this.attachmentsByName || {})) {
				for(const att of (candidates || [])) {
					const override = attachmentOverride[att.parent.name]?.[attName]
					att.cframe.copy(override?.cframe || att.origCFrame)
				}
			}
			
			// Update joints
			for(const joint of this.sortedJointsArray) {
				const overrideC0 = attachmentOverride[joint.part0.name]?.[`${joint.name}RigAttachment`]
				const overrideC1 = attachmentOverride[joint.part1.name]?.[`${joint.name}RigAttachment`]
				
				joint.C0.copy(overrideC0?.cframe || joint.origC0)
				joint.C1Inverse.copy(overrideC1?.cframe || joint.origC1).invert()
			}
			
			// Update parts
			for(const part of Object.values(this.parts)) {
				const bodypart = bodypartOverride[part.name] || part.rbxDefaultBodypart
				
				if(part.rbxBodypart !== bodypart) {
					this.shouldRefreshLayeredClothing = true
					part.rbxBodypart = bodypart
				}

				if(this.playerType === "R15") {
					part.rbxScaleType = bodypart?.scaleType
					this.getScaleMod(part.name, part.rbxScaleType, null, part.rbxScaleMod)
				}
				
				if(!part.isMesh) {
					continue
				}
				
				// Update opacity
				const material = part.material
				const opacity = bodypart.opacity ?? 1
				
				if(material.opacity !== opacity) {
					material.opacity = opacity
					material.transparent = opacity < 1
					material.needsUpdate = true
				}
				
				// Update mesh
				const meshId = bodypart.meshId
				
				if(part.rbxMeshId !== meshId) {
					part.rbxMeshId = meshId
					delete part.rbxMeshLoading
					delete part.rbxMesh
					
					clearGeometry(part)
					
					if(meshId) {
						part.rbxMeshLoading = meshId
						
						AssetCache.loadMesh(true, meshId, mesh => {
							if(part.rbxMeshLoading === meshId) {
								delete part.rbxMeshLoading
								part.rbxMesh = getFirstLod(mesh)
								
								applyMesh(part, part.rbxMesh)
							}
						})
					}
				}
				
				// Only one part per bodypart determines the used MeshPart.TextureId
				let textureId = bodypart.texId
				
				switch(part.name) {
				case "LowerTorso":
					textureId = bodypartOverride.UpperTorso?.texId
					break
				case "LeftLowerArm": case "LeftHand":
					textureId = bodypartOverride.LeftUpperArm?.texId
					break
				case "RightLowerArm": case "RightHand":
					textureId = bodypartOverride.RightUpperArm?.texId
					break
				case "LeftLowerLeg": case "LeftFoot":
					textureId = bodypartOverride.LeftUpperLeg?.texId
					break
				case "RightLowerLeg": case "RightFoot":
					textureId = bodypartOverride.RightUpperLeg?.texId
					break
				}
				
				// Update textures
				const textures = [
					[this.sources.base[part.name], null, bodypart.baseTexId],
					[this.sources[part.name], null, textureId],
					
					[this.sources.pbr[part.name], null, bodypart.colorMapId],
					[material, "normalMap", bodypart.normalMapId],
					[material, "roughnessMap", bodypart.roughnessMapId],
					[material, "metalnessMap", bodypart.metalnessMapId],
				]

				if(bodypart.emissiveMapId) {
					applyEmissiveMapToMaterial(material, bodypart.emissiveMapId, bodypart.emissiveStrength, bodypart.emissiveTint)
				}
				
				if(bodypart.pbrEnabled) {
					material.map = this.textures.pbr[part.name]
					material.needsUpdate = true
					
					// only draw bodycolor if alphamode = 0
					material.map.setSourceEnabled(0, bodypart.pbrAlphaMode === 0)
					
					if(bodypart.pbrAlphaMode === 1) { // Transparent
						material.transparent = true
					}
				} else {
					material.map = this.textures[part.name]
					material.needsUpdate = true
				}
				
				for(const [target, prop, texId] of textures) {
					if(!target) { continue }
					
					const key = `rbx${prop || "texId"}`
					if(target[key] === texId) { continue }
					
					const setImage = img => {
						if(prop) {
							target[prop]?.dispose()
							target[prop] = null
							
							if(img) {
								target[prop] = createTexture(img)
							}
							
							target.needsUpdate = true
						} else {
							target.setImage(img)
						}
					}
					
					target[key] = texId
					setImage(null)
					
					if(texId) {
						AssetCache.loadImage(true, texId, img => {
							if(target[key] === texId) {
								setImage(img)
							}
						})
					}
				}
				
				//
				
				this.activeMaterials.push(material)
			}
			
			// Humanoid scaling
			const updateSizes = () => {
				// Scale parts
				for(const part of Object.values(this.parts)) {
					const scaleMod = part.rbxScaleMod
					
					part.rbxSize = part.rbxBodypart.size || part.rbxOrigSize
					part.rbxScale = part.rbxBodypart.scale || [1, 1, 1]

					if(this.playerType === "R15") {
						part.rbxSize = [
							part.rbxSize[0] * scaleMod.x,
							part.rbxSize[1] * scaleMod.y,
							part.rbxSize[2] * scaleMod.z
						]
						
						part.rbxScale = [
							part.rbxScale[0] * scaleMod.x,
							part.rbxScale[1] * scaleMod.y,
							part.rbxScale[2] * scaleMod.z
						]
					}
					
					if(part.isMesh) {
						part.scale.set(...part.rbxScale)
					}
				}
				
				// Scale joints
				for(const joint of Object.values(this.joints)) {
					scalePosition(joint.bakedC0.copy(joint.C0), joint.part0.rbxScaleMod)
					scalePosition(joint.bakedC1Inverse.copy(joint.C1Inverse), joint.part1.rbxScaleMod)
				}
				
				// Scale attachments
				for(const candidates of Object.values(this.attachmentsByName || {})) {
					for(const att of (candidates || [])) {
						scalePosition(att.bakedCFrame.copy(att.cframe), att.parent.rbxScaleMod)
					}
				}
				
				// Scale rootjoint so that the lowest hip joint aligns with bottom of rootpart
				if(this.playerType === "R15") {
					const rootJoint = this.joints.LowerTorso
					const rightHip = this.joints.RightUpperLeg
					const leftHip = this.joints.LeftUpperLeg
					if(!rootJoint?.bakedC0 || !rightHip?.bakedC0 || !leftHip?.bakedC0) { /* rig not ready */ } else {
					rootJoint.bakedC0.elements[13] =
						- rootJoint.bakedC1Inverse.elements[13]
						- Math.min(rightHip.bakedC0.elements[13], leftHip.bakedC0.elements[13])
						- Math.max(0.05, rootJoint.part0.rbxSize[1]) / 2
				}
				}
			}

			updateSizes()

			// HipHeight and leg stretching
			if(this.playerType === "R15") {
				const lu = this.joints.LeftUpperLeg
				const ll = this.joints.LeftLowerLeg
				const lf = this.joints.LeftFoot
				const ru = this.joints.RightUpperLeg
				const rl = this.joints.RightLowerLeg
				const rf = this.joints.RightFoot
				if(!lu?.bakedC1Inverse || !ll?.bakedC0 || !lf?.bakedC0 || !ru?.bakedC1Inverse || !rl?.bakedC0 || !rf?.bakedC0 || !this.parts?.LeftFoot?.rbxSize) { /* rig not ready */ } else {
				let leftLegSize =
					- lu.bakedC1Inverse.elements[13]
					- ll.bakedC0.elements[13]
					- ll.bakedC1Inverse.elements[13]
					- lf.bakedC0.elements[13]
					- lf.bakedC1Inverse.elements[13]
					+ Math.max(0.05, this.parts.LeftFoot.rbxSize[1]) / 2
				
				let rightLegSize =
					- ru.bakedC1Inverse.elements[13]
					- rl.bakedC0.elements[13]
					- rl.bakedC1Inverse.elements[13]
					- rf.bakedC0.elements[13]
					- rf.bakedC1Inverse.elements[13]
					+ Math.max(0.05, this.parts.RightFoot.rbxSize[1]) / 2
				
				if(leftLegSize >= 0.1 && rightLegSize >= 0.1) {
					const scale = rightLegSize / leftLegSize
					
					if(scale > 1) {
						this.parts.LeftUpperLeg.rbxScaleMod.y *= scale
						this.parts.LeftLowerLeg.rbxScaleMod.y *= scale
						this.parts.LeftFoot.rbxScaleMod.y *= scale
						leftLegSize = rightLegSize
					} else if(scale < 1) {
						this.parts.RightUpperLeg.rbxScaleMod.y /= scale
						this.parts.RightLowerLeg.rbxScaleMod.y /= scale
						this.parts.RightFoot.rbxScaleMod.y /= scale
						rightLegSize = leftLegSize
					}
					
					updateSizes()
				}
				
				const lowerTorso = this.joints.LowerTorso
				const rootPart = this.parts.HumanoidRootPart
				if(lowerTorso?.bakedC0 && rootPart?.rbxSize) {
					const rootHeight =
						-lowerTorso.bakedC0.elements[13]
						- lowerTorso.bakedC1Inverse.elements[13]
						- Math.max(0.05, rootPart.rbxSize[1]) / 2
					
					let min = rootHeight - lu.bakedC0.elements[13] + leftLegSize
					let max = rootHeight - ru.bakedC0.elements[13] + rightLegSize
					if(min < max) { [min, max] = [max, min] }
					
					this.hipHeight = min >= max * 0.95 ? min : max
				}
				}
			} else {
				this.hipHeight = 2
			}
			
			// Update accessories
			let hasEquippedGear = false
			for(const acc of this.accessories.splice(0, this.accessories.length)) {
				if(accessories[acc.asset.id] !== acc) {
					acc.attachment = null
					acc.parent = null
					acc.effectsRuntime?.dispose()
					acc.effectsRuntime = null
					
					if(acc.obj?.parent) {
						acc.obj.parent.remove(acc.obj)
					}
					
					if(acc.wrapLayer) {
						this.shouldRefreshLayeredClothing = true
					}
				}
			}
			
			for(const acc of Object.values(accessories)) {
				const meta = acc.asset.meta
				
				if(acc.wrapLayer) {
					if(!SETTINGS.get("general.previewLayeredClothing")) {
						continue
					}
					
					if(this.playerType !== "R15") {
						continue
					}
				}
				
				// Attach to correct attachment
				const attCFrame = new THREE.Matrix4()
				let attachment
				const assetTypeId = Number(acc?.asset?.assetTypeId)
				const isGear = assetTypeId === AssetType.Gear
				const preferBodyClothingAnchor = !!acc.wrapLayer && LayeredBodyClothingTypeIds.has(assetTypeId)
				const forceHeadAnchor = HeadGapEligibleAccessoryTypeIds.has(assetTypeId)

				// Gear must prioritize rig RightGripAttachment mapping (Tool behavior).
				if(isGear) {
					const ownRightGripAttachment = acc.attachments.find(att => String(att?.name || "") === "RightGripAttachment")
					const rigGripCandidates = this.attachmentsByName?.RightGripAttachment
					if(Array.isArray(rigGripCandidates) && rigGripCandidates.length) {
						attachment = rigGripCandidates.find(x => x?.parent?.name === "RightHand")
							|| rigGripCandidates.find(x => x?.parent?.name === "Right Arm")
							|| rigGripCandidates[rigGripCandidates.length - 1]
						if(attachment) {
							// Do not stack Handle.RightGripAttachment offset with Tool.Grip; that double-applies on many gears.
							if(!acc.toolGripInverse && ownRightGripAttachment?.cframe) {
								attCFrame.copy(ownRightGripAttachment.cframe)
							} else {
								attCFrame.identity()
							}
						}
					}
				}
				
				for(const att of acc.attachments) {
					if(isGear && attachment) { break }
					const candidates = this.attachmentsByName?.[att.name]
					if(Array.isArray(candidates) && candidates.length) {
						const attName = String(att?.name || "")
						const preferHeadByName = HeadAnchorAttachmentNames.has(attName)
						const preferTorsoByName = TorsoAnchorAttachmentNames.has(attName) || attName === "NeckRigAttachment"

						if(isGear) {
							attachment = candidates.find(x => x?.parent?.name === "RightHand")
								|| candidates.find(x => x?.parent?.name === "Right Arm")
								|| candidates.find(x => x?.parent?.name === "RightLowerArm")
								|| candidates.find(x => x?.parent?.name === "RightUpperArm")
								|| candidates.find(x => x?.parent?.name === "UpperTorso")
								|| candidates.find(x => x?.parent?.name === "Torso")
						} else if(forceHeadAnchor) {
							attachment = candidates.find(x => x?.parent?.name === "Head")
								|| candidates.find(x => x?.parent?.name === "UpperTorso")
								|| candidates.find(x => x?.parent?.name === "LowerTorso")
								|| candidates.find(x => x?.parent?.name === "Torso")
						} else if(preferBodyClothingAnchor) {
							if(preferHeadByName) {
								attachment = candidates.find(x => x?.parent?.name === "Head")
									|| candidates.find(x => x?.parent?.name === "UpperTorso")
									|| candidates.find(x => x?.parent?.name === "LowerTorso")
									|| candidates.find(x => x?.parent?.name === "Torso")
							} else if(preferTorsoByName || !preferHeadByName) {
								attachment = candidates.find(x => x?.parent?.name === "UpperTorso")
									|| candidates.find(x => x?.parent?.name === "LowerTorso")
									|| candidates.find(x => x?.parent?.name === "Torso")
									|| candidates.find(x => x?.parent?.name === "Head")
							}
						}

						if(!attachment) {
							attachment = candidates[candidates.length - 1]
						}

						attCFrame.copy(att.cframe)
						break
					}

					if(this.attachments[att.name]) {
						attachment = this.attachments[att.name]
						attCFrame.copy(att.cframe)
						break
					}
				}

				if(isGear && !attachment) {
					for(const gearAttName of GearGripAttachmentNames) {
						const candidates = this.attachmentsByName?.[gearAttName]
						if(!Array.isArray(candidates) || !candidates.length) { continue }
						attachment = candidates.find(x => x?.parent?.name === "RightHand")
							|| candidates.find(x => x?.parent?.name === "Right Arm")
							|| candidates.find(x => x?.parent?.name === "RightLowerArm")
							|| candidates.find(x => x?.parent?.name === "RightUpperArm")
							|| candidates[candidates.length - 1]
						if(attachment) { attCFrame.identity(); break }
					}
				}
				
				const gearFallbackParent = this.parts?.RightHand
					|| this.parts?.["Right Arm"]
					|| this.parts?.RightLowerArm
					|| this.parts?.RightUpperArm
					|| this.parts?.UpperTorso
					|| this.parts?.Torso
				const parent = attachment ? attachment.parent : (isGear ? gearFallbackParent : this.parts.Head)
				
				if(!parent) {
					acc.attachment = null
					acc.parent = null
					acc.effectsRuntime?.dispose()
					acc.effectsRuntime = null
					
					if(acc.obj?.parent) {
						acc.obj.parent.remove(acc.obj)
					}
					
					continue
				}
				
				if(!acc.obj) {
					const opacity = acc.opacity ?? 1
					let material
					const [baseR, baseG, baseB] = normalizeRgbArray(acc.baseColor)
					const baseForMap = [Math.min(1, baseR), Math.min(1, baseG), Math.min(1, baseB)]
					
					if(acc.pbrEnabled) {
						const background = new MergeSource()
						const texture = new MergeSource()
						
						if(acc.pbrAlphaMode === 0) {
							background.setRGB(...baseForMap)
						}
						
						material = new THREE.MeshStandardMaterial({
							transparent: opacity < 1 || acc.pbrAlphaMode === 1,
							opacity: opacity,
							map: new MergeTexture(1024, 1024, background, texture)
						})
						applyHdrColor3ToMaterial(material, baseR, baseG, baseB)
						
						if(acc.colorMapId) {
							AssetCache.loadImage(true, acc.colorMapId, img => {
								texture.setImage(img)
							})
						}
						
						if(acc.normalMapId) {
							AssetCache.loadImage(true, acc.normalMapId, img => {
								material.normalMap = createTexture(img)
								material.needsUpdate = true
							})
						}
						
						if(acc.metalnessMapId) {
							AssetCache.loadImage(true, acc.metalnessMapId, img => {
								material.metalnessMap = createTexture(img)
								material.needsUpdate = true
							})
						}
						
						if(acc.roughnessMapId) {
							AssetCache.loadImage(true, acc.roughnessMapId, img => {
								material.roughnessMap = createTexture(img)
								material.needsUpdate = true
							})
						}

						if(acc.emissiveMapId) {
							applyEmissiveMapToMaterial(material, acc.emissiveMapId, acc.emissiveStrength, acc.emissiveTint)
						}
					} else {
						material = new THREE.MeshStandardMaterial({
							transparent: opacity < 1,
							opacity: opacity,
							map: MergeSource.fromRGB(...baseForMap).toTexture()
						})
						applyHdrColor3ToMaterial(material, baseR, baseG, baseB)
						if(acc.neon) {
							material.emissive.setRGB(...baseForMap)
						}
						
						if(acc.texId) {
							AssetCache.loadImage(true, acc.texId, img => {
								if(!img) return
								material.map = new MergeTexture(256, 256, img)
								if(acc.neon) {
									material.emissive.setRGB(1, 1, 1)
									material.emissiveMap = material.map
								}
								material.needsUpdate = true
							})
							
							if(acc.vertexColor) {
								const [vr, vg, vb] = normalizeRgbArray(acc.vertexColor)
								applyHdrColor3ToMaterial(material, vr, vg, vb)
							}
						}
					}
					
					const obj = acc.obj = new THREE.SkinnedMesh(undefined, material)
					obj.isSkinnedMesh = false
					obj.bindMode = "detached"
					obj.matrixAutoUpdate = false
					obj.frustumCulled = false
					obj.visible = false
					obj.castShadow = true
					
					obj.rbxScaleMod = new THREE.Vector3(1, 1, 1)
					
					obj.layeredMatrix = new THREE.Matrix4()
					obj.matrixNoScale = new THREE.Matrix4()
					obj.skinnedNoScale = new THREE.Matrix4()
					obj.skinnedPoseMatrix = new THREE.Matrix4()
					
					if(acc.meshId) {
						obj.rbxMeshLoading = acc.meshId
						
						AssetCache.loadMesh(true, acc.meshId, mesh => {
							delete obj.rbxMeshLoading
							obj.rbxMesh = getFirstLod(mesh)
							
							applyMesh(obj, obj.rbxMesh)
						})
					}
					
					acc.bakedCFrame = new THREE.Matrix4()
					
					if(acc.wrapLayer) {
						this.shouldRefreshLayeredClothing = true
					}
				}
				
				// Scale
				this.getScaleMod(parent.name, acc.scaleType, parent.rbxScaleType, acc.obj.rbxScaleMod)
				
				if(meta?.scale) {
					acc.obj.rbxScaleMod.x *= meta.scale.X ?? 1
					acc.obj.rbxScaleMod.y *= meta.scale.Y ?? 1
					acc.obj.rbxScaleMod.z *= meta.scale.Z ?? 1
				}
				
				acc.obj.scale.set(...(acc.scale || [1, 1, 1])).multiply(acc.obj.rbxScaleMod)
				
				// Position
				if(attachment) {
					acc.bakedCFrame.copy(attachment.bakedCFrame)
					if(isGear && acc.toolGripInverse) {
						if(this.playerType === "R6") {
							// R6: emulate Roblox RightGrip weld baseline before applying Tool.Grip.
							// Scale the baseline translation like other attachments; tiny -Y nudge closes palm air gap.
							tempMatrix.copy(R6ToolGripOffset)
							scalePosition(tempMatrix, attachment.parent.rbxScaleMod)
							acc.bakedCFrame.multiply(tempMatrix)
							const r6PalmNudgeY = -0.06 * (attachment.parent.rbxScaleMod?.y ?? 1)
							acc.bakedCFrame.multiply(tempMatrix.makeTranslation(0, r6PalmNudgeY, 0))
							acc.bakedCFrame.multiply(acc.toolGripInverse)
						} else {
							acc.bakedCFrame.multiply(acc.toolGripInverse)
						}
					}
					acc.bakedCFrame.multiply(scalePosition(tempMatrix.copy(attCFrame), acc.obj.rbxScaleMod))
				} else {
					// Legacy hats, position is not scaled
					acc.bakedCFrame.makeTranslation(0, 0.5, 0)
					
					if(acc.legacyHatCFrame) {
						acc.bakedCFrame.multiply(acc.legacyHatCFrame)
					}
				}
				
				if(meta?.position) {
					acc.bakedCFrame.elements[12] += (meta.position.X ?? 0) * acc.obj.rbxScaleMod.x
					acc.bakedCFrame.elements[13] += (meta.position.Y ?? 0) * acc.obj.rbxScaleMod.y
					acc.bakedCFrame.elements[14] += (meta.position.Z ?? 0) * acc.obj.rbxScaleMod.z
				}

				if(meta?.rotation) {
					tempVector.setFromMatrixPosition(acc.bakedCFrame)
					acc.bakedCFrame.setPosition(0, 0, 0)

					acc.bakedCFrame.premultiply(tempMatrix.makeRotationFromEuler(tempEuler.set(
						(meta.rotation.X ?? 0) / 180 * Math.PI,
						(meta.rotation.Y ?? 0) / 180 * Math.PI,
						(meta.rotation.Z ?? 0) / 180 * Math.PI,
						"YXZ"
					)))

					acc.bakedCFrame.setPosition(tempVector)
				}

				// Store pre-gap transform so we can reapply when slider changes.
				acc.baseBakedCFrame = acc.bakedCFrame.clone()
				const wrapHeightScale = Number(this.wrapScales?.height ?? this.scales?.height ?? 1)
				const dynamicHeadActive = hasDynamicHeadEquipped(this)
				applyHeadGapOffset(acc, parent, wrapHeightScale, dynamicHeadActive)
				
				// Mesh offset is for classic accessories; applying it to layered clothing
				// can make wrapped geometry appear to float away from the body/head.
				if(acc.offset && !acc.wrapLayer) {
					acc.bakedCFrame.multiply(tempMatrix.makeTranslation(...acc.offset))
				}
				
				//
				
				acc.attachment = attachment
				acc.parent = parent
				
				if(!acc.obj.parent) {
					this.root.add(acc.obj)
				}

				this.accessories.push(acc)
				this.activeMaterials.push(acc.obj.material)
				if(isGear) {
					hasEquippedGear = true
				}
			}
			this._hasEquippedGear = hasEquippedGear
		}
		
		getLayeredRequest() {
			if(!SETTINGS.get("general.previewLayeredClothing")) { return false }
			if(this.playerType !== "R15") { return false }

			const loadedAssets = []

			for(const asset of this.assets) {
				if(!asset.enabled) { continue }
				
				const state = asset.load(this.playerType)
				
				if(!state.loaded) {
					return false
				}

				asset.lastIndex = loadedAssets.length
				loadedAssets.push(asset)
			}

			loadedAssets.sort((a, b) => (a.priority === b.priority ? a.lastIndex - b.lastIndex : a.priority - b.priority))
			
			const accessories = []
			const buildLayeredMeta = acc => {
				if(!acc?.wrapLayer) {
					return !invalidRenderMetaAssetIds[acc?.asset?.id] ? acc?.asset?.meta : undefined
				}

				const baseMeta = (!invalidRenderMetaAssetIds[acc?.asset?.id] && acc?.asset?.meta && typeof acc.asset.meta === "object")
					? { ...acc.asset.meta }
					: {}

				if(!Number.isFinite(baseMeta.puffiness) && Number.isFinite(acc.wrapLayer.puffiness)) {
					baseMeta.puffiness = acc.wrapLayer.puffiness
				}

				if(!Number.isFinite(baseMeta.order) && Number.isFinite(acc.wrapLayer.order)) {
					baseMeta.order = acc.wrapLayer.order
				}

				return Object.keys(baseMeta).length > 0 ? baseMeta : undefined
			}

			for(const acc of this.accessories) {
				if(acc.wrapLayer) {
					if(invalidLayeredAssetIds[acc.asset.id]) { continue }
					
					if(acc.obj.rbxMeshLoading) { // Don't request layered stuff if all meshes are not loaded yet
						return false
					}
					
					if(accessories.length >= 10) {
						// if we have too many layereds, remove first one that has lower or equal priority
						const index = accessories.findIndex(x => !this.accessories.find(acc2 => acc2.asset.id === x.id && acc2.asset.priority > acc.asset.priority))
						
						if(index === -1) {
							continue
						}
						
						accessories.splice(index, 1)
					}
					
					accessories.push({
						id: acc.asset.id,
						meta: buildLayeredMeta(acc)
					})
				}
			}
			
			if(accessories.length === 0) {
				return null
			}

			for(const part of Object.values(this.parts)) {
				if(part.rbxMeshLoading) { // Don't request layered stuff if mesh is not loaded yet
					return false
				}
			}
			
			const bodyparts = []

			const getBodypartRequestInfo = bodypart => {
				const sourceAssetId = Number(bodypart?.sourceAssetId)
				if(Number.isSafeInteger(sourceAssetId) && sourceAssetId > 0) {
					return { id: sourceAssetId, score: 3 }
				}

				const assetTypeId = Number(bodypart?.asset?.assetTypeId)
				const assetId = Number(bodypart?.asset?.id)
				if(assetTypeId === AssetType.Package) {
					// Package ids are not valid bodypart ids for layered render requests.
					return { id: null, score: 0 }
				}

				if(Number.isSafeInteger(assetId) && assetId > 0) {
					return { id: assetId, score: 2 }
				}

				return { id: null, score: 0 }
			}

			const bodypartOverride = {}
			const bodypartOverrideScore = {}

			for(const asset of loadedAssets) {
				const state = asset.get(this.playerType)
				if(!state) { continue }

				for(const bodypart of state.bodyparts) {
					if(!bodypart?.target) { continue }

					const { score } = getBodypartRequestInfo(bodypart)
					const prevScore = bodypartOverrideScore[bodypart.target] ?? -1
					if(score < prevScore) { continue }

					bodypartOverride[bodypart.target] = bodypart
					bodypartOverrideScore[bodypart.target] = score
				}
			}

			const overrideBodypartIds = new Set()
			for(const bodypart of Object.values(bodypartOverride)) {
				const { id: assetId } = getBodypartRequestInfo(bodypart)
				if(!Number.isSafeInteger(assetId) || invalidLayeredAssetIds[assetId]) { continue }
				overrideBodypartIds.add(assetId)
			}

			if(overrideBodypartIds.size > 0) {
				for(const assetId of overrideBodypartIds) {
					bodyparts.push({ id: assetId })
				}
			} else {
				for(const part of Object.values(this.parts)) {
					const bodypart = part.rbxBodypart

					if(bodypart.asset) {
						const { id: assetId } = getBodypartRequestInfo(bodypart)
						if(!Number.isSafeInteger(assetId)) { continue }
						if(invalidLayeredAssetIds[assetId]) { continue }
						
						if(!bodyparts.find(x => x.id === assetId)) { // Multiple parts can share the same asset
							bodyparts.push({ id: assetId })
						}
					}
				}
			}
			
			const baseScales = this.wrapScales || this.scales
			const scales = normalizeWrapRequestScales(baseScales)

			const request = { scales, accessories, bodyparts }

			const ensureHeadBodypart = () => {
				const headPart = this.parts?.Head?.rbxBodypart
				const sourceAssetId = Number(headPart?.sourceAssetId)
				const assetId = Number(headPart?.asset?.id)
				const fallbackHeadId = Number.isSafeInteger(this.headAssetId) && this.headAssetId > 0
					? this.headAssetId
					: null
				const headId = Number.isSafeInteger(sourceAssetId) && sourceAssetId > 0
					? sourceAssetId
					: (Number.isSafeInteger(assetId) && assetId > 0 ? assetId : fallbackHeadId)
				if(headId && !bodyparts.find(x => x.id === headId)) {
					bodyparts.unshift({ id: headId })
				}
			}

			ensureHeadBodypart()
			
			// Avoid duplicate bodypart IDs; duplicates can produce inconsistent wrap resolution.
			const seenBodypartIds = new Set()
			const uniqueBodyparts = []
			for(const row of bodyparts) {
				const id = Number(row?.id)
				if(!Number.isSafeInteger(id) || id <= 0) { continue }
				if(seenBodypartIds.has(id)) { continue }
				seenBodypartIds.add(id)
				uniqueBodyparts.push({ id })
			}
			bodyparts.splice(0, bodyparts.length, ...uniqueBodyparts)
			
			// sort assets by id for hashing
			accessories.sort((a, b) => b.id - a.id)
			bodyparts.sort((a, b) => b.id - a.id)
			
			request.hash = $.hashString(JSON.stringify(request))

			if(globalThis.BTR_WRAP_DEBUG) {
				console.log("[wrap debug] layered request", {
					headAssetId: this.headAssetId ?? null,
					bodyparts: bodyparts.map(x => x.id),
					accessories: accessories.map(x => x.id),
					scales
				})
			}
			
			return request
		}
		
		_refreshLayeredClothing() {
			this.shouldRefreshLayeredClothing = false
			this._headFollowHasHatBindWorld = false
			this._headFollowHasHeadBindWorld = false
			
			const request = this.getLayeredRequest()
			
			if(request === false) {
				this.shouldRefreshLayeredClothing = true
			}
			
			if(!request) {
				if(this.layeredCurrentRequest || this.layeredFinishedRequest) {
					this.layeredFailedRequest = null
					this.layeredFinishedRequest = null
					this.layeredCurrentRequest = null
					
					// reset bodyparts
					for(const part of Object.values(this.parts)) {
						if(part.rbxLayered) {
							applyMesh(part, part.rbxMesh)
						}
					}
					
					// reset accessories
					for(const acc of this.accessories) {
						if(acc.obj.rbxLayered) {
							applyMesh(acc.obj, acc.obj.rbxMesh)
						}
					}
					
					this.trigger("layeredRequestStateChanged", null)
				}
				return
			}
			
			if(request.hash === this.layeredCurrentRequest?.hash) { return }
			if(request.hash === this.layeredFailedRequest?.hash) { return }
			
			this.layeredFailedRequest = null
			this.layeredFinishedRequest = null
			this.layeredCurrentRequest = request
			
			// reset bodyparts
			for(const part of Object.values(this.parts)) {
				if(part.rbxLayered) {
					applyMesh(part, part.rbxMesh)
				}
			}
			
			this.trigger("layeredRequestStateChanged", "fetching")
			
			this._fetchLayeredClothing(request).then(result => {
				if(this.layeredCurrentRequest !== request) { return }
				this.layeredCurrentRequest = null
				
				if(result) {
					this.layeredFinishedRequest = request
				} else {
					this.layeredFailedRequest = request
					
					setTimeout(() => {
						if(this.layeredFailedRequest === request) {
							this.layeredFailedRequest = null
							this.shouldRefreshLayeredClothing = true
						}
					}, 2000)
				}
				
				this.trigger("layeredRequestStateChanged", null)
			})
		}
		
		async _fetchLayeredClothing(request) {
			let objHash = btrLocalStorage.getItem(`btrLayeredCache-${request.hash}`)
			const debugLayered = !!globalThis.BTR_LAYERED_DEBUG
			
			if(!objHash) {
				const bodyColors = this.bodyColors ?? {}
				const asHex = key => String(bodyColors[key] ?? "FFFFFF").replace(/^#/, "").toUpperCase()
				
				const body = {
					avatarDefinition: {
						assets: [
							{ id: 11187668197 }, // anchor
							...request.accessories,
							...request.bodyparts
						],
						bodyColors: {
							headColor: asHex("head"),
							leftArmColor: asHex("leftArm"),
							leftLegColor: asHex("leftLeg"),
							rightArmColor: asHex("rightArm"),
							rightLegColor: asHex("rightLeg"),
							torsoColor: asHex("torso")
						},
						scales: request.scales,
						playerAvatarType: {
							playerAvatarType: "R15"
						}
					},
					thumbnailConfig: {
						thumbnailId: 3,
						thumbnailType: "3d",
						size: "420x420"
					}
				}
				
				// sort assets in case roblox's cache cares about the order
				body.avatarDefinition.assets.sort((a, b) => b.id - a.id)
				
				if(debugLayered) {
					console.log("[BTR layered] request", {
						hash: request.hash,
						accessories: request.accessories.map(x => x.id),
						bodyparts: request.bodyparts.map(x => x.id),
						playerType: this.playerType
					})
				}
				
				await new Promise(resolve => setTimeout(resolve, 200))
				if(this.layeredCurrentRequest !== request) { return }
				
				let json
				
				while(true) {
					json = await RobloxApi.avatar.renderAvatar(body).catch(() => null)
					if(!json || request !== this.layeredCurrentRequest) { return }
					
					if(json.errors) {
						for(const error of json.errors) {
							if(error.code === 2) {
								const assetId = parseInt(error.field?.match(/AssetId: (\d+)/)?.[1], 10)
								if(!Number.isSafeInteger(assetId)) { continue }
								
								if(error.field?.startsWith("InvalidAsset ")) {
									invalidLayeredAssetIds[assetId] = true
								} else if(error.field?.startsWith("InvalidMeta ")) {
									invalidRenderMetaAssetIds[assetId] = true
								}
							}
						}
					}
					
					if(json.state === "Pending") {
						await new Promise(resolve => setTimeout(resolve, 1e3))
						if(request !== this.layeredCurrentRequest) { return }
						continue
					}
					
					break
				}
				
				if(!json?.imageUrl) {
					return
				}
				
				const render = await fetch(json.imageUrl).then(res => res.json())
				if(request !== this.layeredCurrentRequest) { return }
				
				objHash = render.obj
				
				if(objHash) {
					btrLocalStorage.setItem(`btrLayeredCache-${request.hash}`, objHash, { expires: Date.now() + 5 * 60e3 })
				}
			}
			
			let objFile = objCache[objHash]
			
			if(!objFile) {
				const objRes = await fetch(AssetCache.getHashUrl(objHash, "t"))
				if(!objRes.ok) {
					btrLocalStorage.removeItem(`btrLayeredCache-${request.hash}`)
					return
				}
				
				objFile = await objRes.text()
				if(request !== this.layeredCurrentRequest) { return }
				
				objCache[objHash] = objFile
			}
			
			// Read obj file
			const lines = objFile.split("\n")
			const groups = []
			
			let vertexCounter = 1
			let group
			
			for(const line of lines) {
				if(line.startsWith("g ")) {
					const name = line.slice(2)
					
					group = { name: name, vertices: [], uvs: [], faces: [], normals: [], vertexStartIndex: vertexCounter }
					groups.push(group)
				} else if(line.startsWith("f ")) {
					const a = line.slice(2).trim().split(/ |\//g)
					
					group.faces.push(
						+a[0] - group.vertexStartIndex,
						+a[3] - group.vertexStartIndex,
						+a[6] - group.vertexStartIndex
					)
				} else if(line.startsWith("v ")) {
					const pieces = line.split(" ")
					group.vertices.push(+pieces[1], +pieces[2], +pieces[3])
					vertexCounter += 1
					
				} else if(line.startsWith("vt ")) {
					const pieces = line.split(" ")
					group.uvs.push(+pieces[1], +pieces[2])
					
				} else if(line.startsWith("vn ")) {
					const pieces = line.split(" ")
					group.normals.push(+pieces[1], +pieces[2], +pieces[3])
				}
			}
			
			// Calculate layeredMatrix for all parts
			this.parts.HumanoidRootPart.layeredMatrix.copy(this.parts.HumanoidRootPart.matrixNoScale)
			
			for(const joint of this.sortedJointsArray) {
				joint.layeredMatrix.multiplyMatrices(joint.part0.layeredMatrix, joint.bakedC0)
				joint.part1.layeredMatrix.multiplyMatrices(joint.layeredMatrix, joint.bakedC1Inverse)
			}

			// Find and locate anchor
			
			let anchor = groups.find(x => x.name.startsWith("Handle") && x.faces.length === 36 && $.hashString(JSON.stringify([x.faces, x.uvs])) === "4734F03A")
			
			if(!anchor) {
				// Roblox can change anchor UV ordering/hash between versions.
				// Prefer the first anchor-like handle group (same topology), then first handle.
				anchor = groups.find(
					x => x.name.startsWith("Handle")
						&& x.faces.length === 36
						&& x.vertices.length >= 24
				) || groups.find(x => x.name.startsWith("Handle")) || null
			}
			
			if(!anchor) { return false }
			
			groups.splice(groups.indexOf(anchor), 1)
			
			const attachment = this.attachments.HatAttachment
			const scaleMod = this.getScaleMod(attachment.parent.name, "Classic", attachment.parent.rbxScaleType)
			const bakedCFrame = scalePosition(new THREE.Matrix4().makeTranslation(-0.01328277587890625, -0.5544552803039551, -0.65679931640625), scaleMod)
			
			const anchorMatrix = attachment.parent.layeredMatrix.clone().multiply(attachment.bakedCFrame).multiply(bakedCFrame)
			
			const min = [Infinity, Infinity, Infinity]
			const max = [-Infinity, -Infinity, -Infinity]
			
			for(let i = 0; i < anchor.vertices.length; i += 3) {
				const x = anchor.vertices[i]
				const y = anchor.vertices[i + 1]
				const z = anchor.vertices[i + 2]
				
				min[0] = Math.min(min[0], x)
				min[1] = Math.min(min[1], y)
				min[2] = Math.min(min[2], z)
				
				max[0] = Math.max(max[0], x)
				max[1] = Math.max(max[1], y)
				max[2] = Math.max(max[2], z)
			}
			
			const inverseRenderMatrix = new THREE.Matrix4().makeTranslation(
				(max[0] + min[0]) / 2,
				(max[1] + min[1]) / 2,
				(max[2] + min[2]) / 2
			).invert().premultiply(anchorMatrix)
			
			// NOTE: As far as I can tell, the character seems to be consistently positioned at (0, 100.01 + characterAndAccessoriesAABB.Size.Y / 2, 0)
			// so we could technically skip this anchor stuff and do the aabb calculation ourselves...
			
			//
			
			const transform = new THREE.Matrix4()
			const vertex = new THREE.Matrix4()
			
			// Resolve bodyparts
			const uvBoxes = {
				full:     [0, 0, 1, 1],
				torso:    [  0 / 916, 296 / 568, 388 / 916, 272 / 568],
				head:     [132 / 916,   0 / 568, 256 / 916, 296 / 568],
				leftarm:  [388 / 916, 284 / 568, 264 / 916, 284 / 568],
				rightarm: [652 / 916, 284 / 568, 264 / 916, 284 / 568],
				leftleg:  [388 / 916,   0 / 568, 264 / 916, 284 / 568],
				rightleg: [652 / 916,   0 / 568, 264 / 916, 284 / 568],
			}
			
			const UV_MATCH_EPSILON = 0.025
			const getGroupMatch = (mesh, group, box) => {
				if(group.uvs.length !== mesh.uvs.length) {
					return null
				}
				
				// For accessories we need strict topology match; otherwise
				// similarly-UV'd groups can bind to the wrong handle and stretch.
				if(group.vertices.length !== mesh.vertices.length || group.faces.length !== mesh.faces.length) {
					return null
				}
				
				const [x0, y0, width, height] = box
				
				for(let i = 0, len = group.uvs.length; i < len; i += 2) {
					const u = (group.uvs[i] - x0) / width
					const v = (group.uvs[i + 1] - y0) / height
					
					const u2 = mesh.uvs[i]
					const v2 = mesh.uvs[i + 1]
					
					if(Math.abs(u2 - u) > UV_MATCH_EPSILON || Math.abs(v2 - v) > UV_MATCH_EPSILON) {
						return null
					}
				}
				
				return true
			}
			
			const getGroupMatchPartial = (mesh, group, box) => {
				if(group.uvs.length > mesh.uvs.length) {
					return null
				}
				
				const [x0, y0, width, height] = box
				const mapping = []
				
				let search = 0
				
				outer:
				for(let i = 0, len = group.uvs.length; i < len ; i += 2) {
					const u = (group.uvs[i] - x0) / width
					const v = (group.uvs[i + 1] - y0) / height
					
					while(search < mesh.uvs.length) {
						const u2 = mesh.uvs[search]
						const v2 = mesh.uvs[search + 1]
						
						search += 2
						
						if(Math.abs(u2 - u) < UV_MATCH_EPSILON && Math.abs(v2 - v) < UV_MATCH_EPSILON) {
							mapping.push(search / 2 - 1)
							continue outer
						}
					}
					
					return null
				}
				
				return mapping
			}
			
			const playerGroups = groups.filter(x => x.name.startsWith("Player"))
			let numEmptyPartsAccepted = 15 - playerGroups.length
			
			for(const part of Object.values(this.parts)) {
				const mesh = part.rbxMesh
				if(!mesh) { continue }
				
				const partBox = uvBoxes[part.name.replace(/Upper|Lower/g, "").replace(/Hand/g, "Arm").replace(/Foot/g, "Leg").toLowerCase()]
				const matches = []
				
				for(const group of playerGroups) {
					const mapping = partBox && getGroupMatchPartial(mesh, group, partBox) || getGroupMatchPartial(mesh, group, uvBoxes.full)
					
					if(mapping) {
						matches.push({ group, mapping })
					}
				}
				
				if(matches.length === 0) {
					// If the whole part was hidden by HSR, it doesn't get added into the render
					
					if(numEmptyPartsAccepted > 0) {
						numEmptyPartsAccepted -= 1
					} else {
						console.log("Failed to find match for bodypart")
						
						if(IS_DEV_MODE) {
							console.log(part.name, part.rbxMesh)
							console.log(groups)
							console.log(request)
						}
						
						request.failedToResolveAllAccessories = true
					}
				}
				
				if(matches.length >= 2) {
					// If more than two match, somehow choose one of them
					// My best idea atm is just to compare distance from
					// vertices to where the part should be
					
					const px = part.layeredMatrix.elements[12]
					const py = part.layeredMatrix.elements[13]
					const pz = part.layeredMatrix.elements[14]
					
					let closestDistance = Infinity
					let closest
					
					for(const match of matches) {
						const { group } = match
						
						const step = Math.max(1, Math.floor(group.vertices.length / 3 / 50)) * 3
						let x = 0, y = 0, z = 0, count = 0
						
						for(let i = 0; i < group.vertices.length; i += step) {
							x += group.vertices[i]
							y += group.vertices[i + 1]
							z += group.vertices[i + 2]
							count += 1
						}
						
						const distance = (x / count - px) ** 2 + (y / count - py) ** 2 + (z / count - pz) ** 2
						
						if(distance < closestDistance) {
							closestDistance = distance
							closest = match
						}
					}
					
					matches.splice(0, matches.length, closest)
				}
				
				if(matches.length > 0) {
					const { group, mapping } = matches[0]
					playerGroups.splice(playerGroups.indexOf(group), 1) // only match each group once
					
					// apply transformed vertices and normals
					transform.copy(part.layeredMatrix).invert().multiply(inverseRenderMatrix)
					
					// Order of vertices matters for bones/skinnedmesh stuff, so update vertices in place rather than just replacing them all
					const vertices = mesh.vertices.slice()
					const normals = mesh.normals.slice()
					
					for(let index = 0; index < group.vertices.length; index += 3) {
						const mappedIndex = mapping[index / 3] * 3
						
						vertex.makeTranslation(
							group.vertices[index + 0],
							group.vertices[index + 1],
							group.vertices[index + 2]
						).premultiply(transform)
						
						vertices[mappedIndex + 0] = vertex.elements[12] / part.rbxScale[0]
						vertices[mappedIndex + 1] = vertex.elements[13] / part.rbxScale[1]
						vertices[mappedIndex + 2] = vertex.elements[14] / part.rbxScale[2]
						
						vertex.makeTranslation(
							group.normals[index + 0] - transform.elements[12],
							group.normals[index + 1] - transform.elements[13],
							group.normals[index + 2] - transform.elements[14]
						).premultiply(transform)
						
						normals[mappedIndex + 0] = vertex.elements[12]
						normals[mappedIndex + 1] = vertex.elements[13]
						normals[mappedIndex + 2] = vertex.elements[14]
					}
					
					// Order of faces doesn't seem to matter though, so we can just directly use the group faces as long as we map the vertex indices
					const faces = Uint32Array.from(group.faces)
					
					for(let i = 0; i < faces.length; i++) {
						faces[i] = mapping[faces[i]]
					}
					//
					
					part.geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3))
					part.geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3))
					part.geometry.setIndex(new THREE.BufferAttribute(faces, 1))
				} else {
					// Keep original mesh when layered transform resolution fails for this part.
					// Dropping geometry entirely causes obvious visual breakage.
					applyMesh(part, mesh)
				}
				
				part.rbxLayered = { wrapTarget: part.rbxBodypart.wrapTarget || part.rbxDefaultBodypart.wrapTarget }
			}
			
			// Resolve accessories
			const handleGroups = groups.filter(x => x.name.startsWith("Handle"))
			let numEmptyAccessoriesAccepted = request.accessories.length - handleGroups.length
			const layeredHeightScale = Number(request?.scales?.height ?? this.wrapScales?.height ?? this.scales?.height ?? 1)
			const layeredDynamicHeadActive = hasDynamicHeadEquipped(this)
			const layeredHeadGap = getHeadGap(layeredHeightScale, layeredDynamicHeadActive) + 0.02
			
			for(const acc of this.accessories) {
				if(!acc.obj.rbxMesh || !request.accessories.find(x => x.id === acc.asset.id)) { continue}
				
				const obj = acc.obj
				const mesh = obj.rbxMesh
				obj.layeredMatrix.multiplyMatrices(acc.parent.layeredMatrix, acc.bakedCFrame)

				clampDynamicHoodAboveHead(acc, this, obj.layeredMatrix, layeredHeightScale, layeredDynamicHeadActive, true)

				if(shouldApplyHeadGapOffset(acc, acc.parent, layeredHeightScale, layeredDynamicHeadActive)) {
					obj.layeredMatrix.elements[13] -= layeredHeadGap
				}
				
				const matches = []
				
				for(const group of handleGroups) {
					if(getGroupMatch(mesh, group, uvBoxes.full)) {
						matches.push({
							group: group,
							strictTopologyMatch: true
						})
					}
				}
				
				// sometimes autoskinned meshes have their uvs re-ordered, so I guess we'll do this?
				const doAutoSkinHack = matches.length === 0
					&& acc.wrapLayer.autoSkin
					&& !this.accessories.find(x =>
						x !== acc
						&& x.wrapLayer
						&& x.obj?.rbxMesh?.uvs?.length === mesh.uvs.length
					)
				
				if(doAutoSkinHack) {
					for(const group of handleGroups) {
						if(group.uvs.length === mesh.uvs.length) {
							matches.push({
								group: group,
								strictTopologyMatch: false
							})
						}
					}
				}
				
				if(matches.length === 0) {
					if(debugLayered) {
						console.log("[BTR layered] unresolved accessory", {
							assetId: acc.asset.id,
							autoSkin: !!acc.wrapLayer?.autoSkin,
							meshVerts: mesh.vertices.length,
							meshUvs: mesh.uvs.length,
							handleGroups: handleGroups.length
						})
					}
					if(numEmptyAccessoriesAccepted > 0) {
						numEmptyAccessoriesAccepted -= 1
					} else {
						console.log("Could not resolve asset in render")
						
						if(IS_DEV_MODE) {
							console.log(acc.asset.id, mesh)
							console.log(groups)
							console.log(request)
						}
						
						request.failedToResolveAllAccessories = true
					}
				}
				
				if(matches.length >= 2) {
					// If more than two match, somehow choose one of them
					// My best idea atm is just to compare distance from
					// vertices to where the part should be
					
					const px = obj.layeredMatrix.elements[12]
					const py = obj.layeredMatrix.elements[13]
					const pz = obj.layeredMatrix.elements[14]
					
					let closestDistance = Infinity
					let closest
					
					for(const match of matches) {
						const group = match.group
						const step = Math.max(1, Math.floor(group.vertices.length / 3 / 50)) * 3
						let x = 0, y = 0, z = 0, count = 0
						
						for(let i = 0; i < group.vertices.length; i += step) {
							x += group.vertices[i]
							y += group.vertices[i + 1]
							z += group.vertices[i + 2]
							count += 1
						}
						
						const distance = (x / count - px) ** 2 + (y / count - py) ** 2 + (z / count - pz) ** 2
						
						if(distance < closestDistance) {
							closestDistance = distance
							closest = match
						}
					}
					
					if(debugLayered) {
						console.log("[BTR layered] multi-match resolved", {
							assetId: acc.asset.id,
							candidates: matches.length,
							chosenVerts: closest?.group?.vertices?.length ?? 0
						})
					}
					
					matches.splice(0, matches.length, closest)
				}
				
				const match = matches[0]
				const group = match?.group
				if(group) {
					handleGroups.splice(handleGroups.indexOf(group), 1) // only match each group once
					
					transform.copy(obj.layeredMatrix).invert().multiply(inverseRenderMatrix)
					// Always use Roblox rendered group geometry for layered accessories.
					// This is more reliable for jackets/sweaters on dynamic heads/bundles.
					const vertexCount = Math.floor(group.vertices.length / 3)
					const transformedVertices = new Float32Array(vertexCount * 3)
					const transformedNormals = new Float32Array(vertexCount * 3)
					const bakedScale = acc.wrapLayer?.autoSkin
						? tempVector.set(1, 1, 1)
						: obj.scale
					const sx = Math.abs(Number(bakedScale?.x)) > 1e-6 ? Number(bakedScale.x) : 1
					const sy = Math.abs(Number(bakedScale?.y)) > 1e-6 ? Number(bakedScale.y) : 1
					const sz = Math.abs(Number(bakedScale?.z)) > 1e-6 ? Number(bakedScale.z) : 1
					
					for(let i = 0; i < group.vertices.length; i += 3) {
						vertex.makeTranslation(
							group.vertices[i + 0],
							group.vertices[i + 1],
							group.vertices[i + 2]
						).premultiply(transform)
						transformedVertices[i + 0] = vertex.elements[12] / sx
						transformedVertices[i + 1] = vertex.elements[13] / sy
						transformedVertices[i + 2] = vertex.elements[14] / sz

						vertex.makeTranslation(
							group.normals[i + 0] - transform.elements[12],
							group.normals[i + 1] - transform.elements[13],
							group.normals[i + 2] - transform.elements[14]
						).premultiply(transform)
						transformedNormals[i + 0] = vertex.elements[12]
						transformedNormals[i + 1] = vertex.elements[13]
						transformedNormals[i + 2] = vertex.elements[14]
					}

					const hoodVertexDrop = getDynamicHeadHoodVertexDrop(acc, layeredHeightScale, layeredDynamicHeadActive)
					if(hoodVertexDrop > 0) {
						applyTopWeightedVertexDrop(transformedVertices, hoodVertexDrop)
					}

					applyMesh(acc.obj, {
						vertices: transformedVertices,
						normals: transformedNormals,
						uvs: Float32Array.from(group.uvs),
						faces: Uint32Array.from(group.faces),
						lods: [0, Math.floor(group.faces.length / 3)],
						bones: null,
						skinIndices: null,
						skinWeights: null
					})
					acc.obj.rbxHeadFollowVersion = (acc.obj.rbxHeadFollowVersion || 0) + 1
					delete acc.headFollowDeformer
					
				} else {
					acc.obj.geometry.deleteAttribute("position")
					acc.obj.geometry.deleteAttribute("normal")
					acc.obj.geometry.deleteAttribute("uv")
					acc.obj.geometry.setIndex(null)
					acc.obj.rbxHeadFollowVersion = (acc.obj.rbxHeadFollowVersion || 0) + 1
					delete acc.headFollowDeformer
				}
				
				acc.obj.rbxLayered = {
					wrapLayer: acc.wrapLayer,
					initialScale: acc.parent?.rbxScaleMod?.clone()
				}
			}
			
			return true
		}
	}

	return {
		Avatar,
		
		LocalAssets,
		R6BodyPartNames,
		R15BodyPartNames,

		CFrameToMatrix4,
		applyMesh
	}
})()

if(typeof globalThis !== "undefined") {
	globalThis.RBXAvatar = RBXAvatar
}
