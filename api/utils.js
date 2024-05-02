/**
 * Utils
 */

import fs    from 'fs'
import mimes from 'mime-types'
import sharp from 'sharp'

// ++ consts
const TEMP_DIR = 'tmp'

/**
 * Validate Image constraints
 * @param {string} path - The file path
 * @param {object} options - The validation options constraints
 * @returns {boolean}
 */
async function validateImage(path, { width, height, minWidth, minHeight, ratio }) {

	const image = await sharp(path).metadata()

	if (width && width != image.width) throw 'FILE_INVALID_WIDTH'
	if (height && height != image.height) throw 'FILE_INVALID_HEIGHT'

	if (minWidth && minWidth > image.width) throw 'FILE_INVALID_WIDTH'
	if (minHeight && minHeight > image.height) throw 'FILE_INVALID_HEIGHT'

	if (ratio) {

		const r = ratio.split('/')

		if ((r[0]/r[1]).toFixed(1) != (image.width/image.height).toFixed(1)) throw 'FILE_INVALID_RATIO'
	}

	return true
}

/**
 * Transforms an image
 * @param {object} file - The file object
 * @param {array} transforms - The transforms array
 * @param {string} outputFormat - The output format
 * @return {array}
 */
async function transformImage({ path, filename }, transforms = [], outputFormat) {

	console.time(`transform-image_${filename}`)

	const image = sharp(path)
	const files = []

	for (const { name: transformName, width, height, blur, quality = 100 } of transforms) {

		// ignore transform without name
		if (!transformName) continue

		// ++ resize
		if (width && height) await image.resize({ width, height })
		else if (width) await image.resize({ width })
		else if (height) await image.resize({ height })

		// ++ blur
		if (blur) await image.blur(blur)

		const _filename = `${filename}_${transformName}`
		const _path     = `${TEMP_DIR}/${_filename}`
		const _mimetype = mimes.lookup(outputFormat)

		// saves transformed image to disk
		await image.toFormat(outputFormat, { quality }).toFile(_path)

		// push file
		files.push({ path: _path, filename: _filename, mimetype: _mimetype })
	}

	console.timeEnd(`transform-image_${filename}`)
	return files
}

/**
 * Nearest Aspect Ratio calculator for images
 * @param {string} path - The input file path
 * @param {integer} maxWidth - The maximum width in the nearest normal aspect ratio (optional)
 * @param {integer} maxWidth - The maximum height in the nearest normal aspect ratio (optional)
 * @return {string}
 */
async function nearestImageAspectRatio(path, maxWidth = 16, maxHeight = 16) {

	const image = await sharp(path).metadata()
	// get image dimensions
	let width  = image.width
	let height = image.height

	const needsRotation = width > height

	if (needsRotation) {

		const _width = width
		width  = height
		height = _width
	}

	const absoluteRatio = width / height

	let ratio = 1
	let normalRatio = [1, 1]

	for (let i = 1; i <= maxHeight; i++) {

		for (let j = 1; j <= maxWidth; j++) {

			const value = j/i

			if (Math.abs(value - absoluteRatio) < Math.abs(ratio - absoluteRatio)) {

				ratio = value
				normalRatio = [j, i]
			}
		}
	}

	return (needsRotation ? normalRatio.reverse() : normalRatio).join(':')
}

/**
 * Rename File
 * @param {string} file - The input file
 * @param {string} newFilename - The new filename
 * @returns {object}
 */
function renameFile({ path, filename }, newFilename) {

	if (!path || !filename) return

	const newPath = path.replace(filename, newFilename)
	// rename file
	fs.renameSync(path, newPath)

	return { path: newPath, filename: newFilename}
}

/**
 * Remove File
 * @param {string} filename - The file name in temp directory
 * @returns {undefined}
 */
function removeFile(filename) {

	if (!filename) return

	const files = fs.readdirSync(TEMP_DIR).filter(f => f.match(new RegExp(filename, 'g')))

	for (const f of files) {

		console.log(`Utils (removeFile) -> removing file: ${TEMP_DIR}/${f}`)
		fs.unlinkSync(`${TEMP_DIR}/${f}`)
	}
}

/**
 * Remove Limbo files that couldn't be removed
 * @returns {undefined}
 */
function removeLimboFiles() {

	// filter in size
	const files = fs.readdirSync(TEMP_DIR).filter(f => f.length >= 32)

	for (const f of files) {

		try {

			const { mtime } = fs.statSync(`${TEMP_DIR}/${f}`)
			if (!mtime) continue

			const diff = new Date().valueOf() - new Date(mtime).valueOf()
			// 12 hours expiry
			if (diff >= 43_200_000)
				removeFile(f)
		}
		catch (e) { console.warn(`Utils (removeLimboFiles) -> failed reading file ${f}`, e.toString()) }
	}
}

/**
 * Join Path Helper
 * @param  {...string} args
 * @returns {string}
 */
function joinPath(...args) {

	return args.filter(o => o).join('/').replace(/\/{2,}/g, '/')
}

/**
 * Export
 */
export {

	validateImage,
	transformImage,
	nearestImageAspectRatio,
	renameFile,
	removeFile,
	removeLimboFiles,
	joinPath,
}
