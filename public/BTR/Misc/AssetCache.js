"use strict"

const AssetCache = (() => {
	const resolveCache = {}
	const cdnCache = {}

	function resolveAssetUrlParams(request, strict=false) {
		let url = request.trim()
		
		if(url.startsWith("rbxassetid://")) {
			url = `https://www.roblox.com/asset/?id=${url.slice(13)}`
		} else if(url.startsWith("rbxhttp://")) {
			url = `https://www.roblox.com/${url.slice(10)}`
		}
		
		let urlParams
		let urlInfo
		
		try { urlInfo = new URL(url) }
		catch {}
		
		if(!urlInfo) {
			throw new TypeError(`Invalid request '${request}'`)
		}
		
		if(!/^https?:$/.test(urlInfo.protocol)) {
			throw new TypeError(`Invalid request '${request}'`)
		}
		
		if(urlInfo.hostname.startsWith("assetdelivery.")) {
			if(/^\/+v1\/+asset\/*$/i.test(urlInfo.pathname)) {
				urlParams = urlInfo.searchParams
			}
		} else {
			if(/^\/+asset\/*$/i.test(urlInfo.pathname)) {
				urlParams = urlInfo.searchParams
			}
		}
		
		if(!urlParams) {
			throw new TypeError(`Invalid request '${request}'`)
		}
		
		if(strict && urlParams.get("hash")) {
			throw new TypeError(`Invalid request '${request}': hash does not work in strict mode`)
		}

		return urlParams
	}
	
	function createMethod(constructor) {
		const methodCache = {}

		return (strict, request, params, cb) => {
			if(typeof strict !== "boolean") {
				cb = params
				params = request
				request = strict
				strict = false
			}
			
			if(typeof params === "function") {
				cb = params
				params = null
			}
			
			let resolvePromise
			
			if(!strict && typeof request === "string" && /^https?:\/\/[^\/]+\.rbxcdn\.com\/*[0-9a-fA-F]{32}/i.test(request)) {
				const assetRequest = {
					strict, request, params,
					cacheKey: request,
					location: request
				}
				
				resolvePromise = Promise.resolve(assetRequest)
				resolvePromise.assetRequest = assetRequest
			} else {
				resolvePromise = AssetCache.resolveAsset(strict, request, params)
			}
			
			const cacheKey = resolvePromise.assetRequest.cacheKey
			let methodPromise = methodCache[cacheKey]
			
			if(!methodPromise) {
				methodPromise = resolvePromise.then(async assetRequest => {
					let currentRequest = assetRequest
					let buffer
					
					try {
						buffer = await AssetCache.loadDirect(currentRequest.location, params)
					} catch(err) {
						const message = String(err?.message ?? err ?? "")
						const shouldRetry =
							message.includes("(403") ||
							message.includes(" 403") ||
							message.includes("403 Forbidden")
						
						if(!shouldRetry || !currentRequest?.cacheKey || !currentRequest?.urlParams) {
							throw err
						}
						
						delete resolveCache[currentRequest.cacheKey]
						
						currentRequest = await AssetCache.resolveAsset(
							currentRequest.strict,
							currentRequest.request,
							{ ...(currentRequest.params ?? {}), cache: false }
						)
						
						buffer = await AssetCache.loadDirect(currentRequest.location, { ...(params ?? {}), cache: false })
					}
					
					return constructor(buffer, currentRequest)
				}).catch(err => {
					console.error(err)
					delete methodCache[cacheKey]
					return null
				})
				
				if(params?.cache !== false) {
					methodCache[cacheKey] = methodPromise
				}
			}
			
			if(typeof cb === "function") {
				methodPromise.then(cb)
			}
			
			return methodPromise
		}
	}

	function guessImageMimeType(buffer) {
		const bytes = new Uint8Array(buffer || [])
		if(bytes.length >= 8 &&
			bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
			bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
			return "image/png"
		}
		if(bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
			return "image/jpeg"
		}
		if(bytes.length >= 6 &&
			bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
			bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
			return "image/gif"
		}
		if(bytes.length >= 12 &&
			bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
			bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
			return "image/webp"
		}
		if(bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4D) {
			return "image/bmp"
		}
		if(bytes.length >= 4 && bytes[0] === 0x3C && bytes[1] === 0x73 && bytes[2] === 0x76 && bytes[3] === 0x67) {
			return "image/svg+xml"
		}
		return ""
	}
	
	return {
		resolveAsset: (strict, request, params) => {
			if(typeof strict !== "boolean") {
				params = request
				request = strict
				strict = false
			}
			
			let urlParams
			
			if(!strict && Number.isSafeInteger(+request)) {
				urlParams = new URLSearchParams({ id: request })
			} else if(!strict && request instanceof Object) {
				urlParams = new URLSearchParams(request)
			} else if(typeof request === "string") {
				urlParams = resolveAssetUrlParams(request, strict)
			}
			
			let cacheKey = urlParams.toString()
			
			if(params?.format) { cacheKey += "@f:" + params.format }
			if(params?.browserAssetRequest) { cacheKey += "@bar" }
			
			let resolvePromise = resolveCache[cacheKey]
				
			if(!resolvePromise) {
				const assetRequest = {
					strict, request, params, cacheKey,
					urlParams: urlParams.toString()
				}
				
				resolvePromise = RobloxApi.assetdelivery.requestAssetV2(urlParams, {
					format: params?.format,
					browserAssetRequest: params?.browserAssetRequest
				}).then(json => {
					if(!json?.locations?.length) {
						throw new Error(`Unable to download asset "${JSON.stringify(assetRequest)}"`)
					}
					
					assetRequest.location = json.locations[0].location
					assetRequest.assetTypeId = json.assetTypeId
					
					return assetRequest
				})
				
				resolvePromise.assetRequest = assetRequest
				
				if(params?.cache !== false) {
					resolveCache[cacheKey] = resolvePromise
				}
			}
			
			return resolvePromise
		},
		loadDirect: (cdnUrl, params) => {
			if(cdnCache[cdnUrl]) { return cdnCache[cdnUrl] }
			
			let cdnPromise = cdnCache[cdnUrl]
			
			if(!cdnPromise) {
				cdnPromise = (window.electronAPI?.fetchRobloxAPI
					? window.electronAPI.fetchRobloxAPI(cdnUrl).then(res => {
						if(!res?.ok) {
							throw new Error(`Failed to download asset '${cdnUrl}' (${res?.status ?? 0} ${res?.statusText ?? ""})`)
						}
						
						const raw = res.data
						if(raw instanceof ArrayBuffer) {
							return raw
						}
						if(ArrayBuffer.isView(raw)) {
							return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
						}
						// Tauri proxy: binary CDN bodies arrive as base64 (see fetch_roblox_api).
						if(raw && typeof raw === "object" && raw.__btrBinary && typeof raw.base64 === "string") {
							const bin = atob(raw.base64)
							const arr = new Uint8Array(bin.length)
							for(let i = 0; i < bin.length; i++) {
								arr[i] = bin.charCodeAt(i)
							}
							return arr.buffer
						}
						if(raw && typeof raw === "object" && raw.type === "Buffer" && Array.isArray(raw.data)) {
							return Uint8Array.from(raw.data).buffer
						}
						if(Array.isArray(raw)) {
							return Uint8Array.from(raw).buffer
						}
						if(typeof raw === "string") {
							// Prefer base64 if the bridge sent raw b64 without the envelope.
							if(/^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.replace(/\s/g, "").length % 4 === 0 && raw.length > 64) {
								try {
									const bin = atob(raw.replace(/\s/g, ""))
									const arr = new Uint8Array(bin.length)
									for(let i = 0; i < bin.length; i++) {
										arr[i] = bin.charCodeAt(i)
									}
									return arr.buffer
								} catch {
									/* fall through to latin1 */
								}
							}
							// Latin-1 round-trip (Electron sometimes returns binary as string).
							const arr = new Uint8Array(raw.length)
							for(let i = 0; i < raw.length; i++) {
								arr[i] = raw.charCodeAt(i) & 0xff
							}
							return arr.buffer
						}
						
						throw new Error(`Unsupported proxy data type for '${cdnUrl}'`)
					})
					: fetch(cdnUrl).then(res => {
						if(!res.ok) {
							throw new Error(`Failed to download asset '${cdnUrl}'`)
						}
						
						return res.arrayBuffer()
					})).catch(err => {
						delete cdnCache[cdnUrl]
						throw err
					})
				
				if(params?.cache !== false) {
					cdnCache[cdnUrl] = cdnPromise
				}
			}
			
			return cdnPromise
		},
		
		loadAnimation: createMethod(async (buffer, assetRequest) => {
			await loadOptionalFeature("parser")
			
			const findSequence = array => {
				for(const inst of array) {
					if(inst.ClassName === "KeyframeSequence" || inst.ClassName === "CurveAnimation") {
						return inst
					}
					
					const sequence = findSequence(inst.Children)
					if(sequence) {
						return sequence
					}
				}
				
				return null
			}
			
			if(assetRequest.params?.async) {
				return RBXModelParser.parse(
					buffer, { async: true, onProgress: assetRequest.params?.onProgress }
				).promise.then(parser => {
					const sequence = findSequence(parser.result)
					if(!sequence) { return null }
					return RBXAnimationParser.parse(sequence)
				})
			}
			
			const sequence = findSequence(RBXModelParser.parse(buffer).result)
			if(!sequence) { return null }
			return RBXAnimationParser.parse(sequence)
		}),
		loadModel: createMethod(async (buffer, assetRequest) => {
			await loadOptionalFeature("parser")
			
			if(assetRequest.params?.async) {
				return RBXModelParser.parse(
					buffer, { async: true, onProgress: assetRequest.params?.onProgress }
				).promise.then(parser => parser.result)
			}
			
			return RBXModelParser.parse(buffer).result
		}),
		loadMesh: createMethod(async (buffer, assetRequest) => {
			await loadOptionalFeature("parser")
			return RBXMeshParser.parse(buffer)
		}),
		
		loadImage: createMethod((buffer, assetRequest) => new Promise((resolve, reject) => {
			const bytes = new Uint8Array(buffer)
			const guessedType = guessImageMimeType(buffer)
			const objectUrls = []
			let settled = false

			const cleanup = () => {
				for(const url of objectUrls) {
					try { URL.revokeObjectURL(url) } catch {}
				}
			}

			const finish = image => {
				if(settled) { return }
				settled = true
				cleanup()
				resolve(image)
			}
			const fail = () => {
				if(settled) { return }
				settled = true
				cleanup()
				reject(new Error(`invalid image ${JSON.stringify(assetRequest)}`))
			}

			const tryLoad = mimeType => new Promise(resolveTry => {
				const blob = mimeType ? new Blob([bytes], { type: mimeType }) : new Blob([bytes])
				const src = URL.createObjectURL(blob)
				objectUrls.push(src)

				const image = new Image()
				image.onload = () => resolveTry(image)
				image.onerror = () => resolveTry(null)
				image.src = src
			})

			const attempts = []
			if(guessedType) { attempts.push(guessedType) }
			attempts.push("image/png", "")

			;(async () => {
				for(const type of attempts) {
					const image = await tryLoad(type)
					if(image) {
						finish(image)
						return
					}
				}
				fail()
			})().catch(fail)
		})),
		loadBuffer: createMethod((buffer, assetRequest) => buffer),
		loadText: createMethod((buffer, assetRequest) => $.bufferToString(buffer)),

		getHashUrl(hash, prefix="c") {
			let code = 31
			
			for(let n = 0; n < hash.length; n++) {
				code ^= hash.charCodeAt(n)
			}
			
			return `https://${prefix}${code % 8}.rbxcdn.com/${hash}`
		},
		toAssetUrl(id) {
			return `https://assetdelivery.roblox.com/v1/asset/?id=${id}`
		},
		isValidAssetUrl(url) {
			try { return resolveAssetUrlParams(url, true), true }
			catch {}
			
			return false
		},
		getAssetIdFromUrl(url) {
			try { return resolveAssetUrlParams(url, true).get("id") ?? null }
			catch {}
			
			return null
		}
	}
})()

if(typeof globalThis !== "undefined") {
	globalThis.AssetCache = AssetCache
}
