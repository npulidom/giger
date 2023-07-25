/**
 * Utils
 */

import imagemin from 'imagemin'
import mozjpeg  from 'imagemin-mozjpeg'
import pngquant from 'imagemin-pngquant'
import jimp     from 'jimp'

const TEMP_DIR = 'tmp'

/**
 * Validate Image constraints
 * @param {string} filepath - The input filepath
 * @param {object} options - The validation options constraints
 * @returns {boolean}
 */
async function validateImage(filepath, { width, height, minWidth, minHeight, ratio }) {

	const image = await jimp.read(filepath)

	if (width && width != image.bitmap.width) throw 'FILE_INVALID_WIDTH'
	if (height && height != image.bitmap.height) throw 'FILE_INVALID_HEIGHT'

	if (minWidth && minWidth > image.bitmap.width) throw 'FILE_INVALID_WIDTH'
	if (minHeight && minHeight > image.bitmap.height) throw 'FILE_INVALID_HEIGHT'

	if (ratio) {

		const r = ratio.split('/')

		if ((r[0]/r[1]).toFixed(1) != (image.bitmap.width/image.bitmap.height).toFixed(1)) throw 'FILE_INVALID_RATIO'
	}

	return true
}

/**
 * Transforms
 * @param {string} filepath - The input filepath
 * @param {string} filename - The input filename for destination
 * @param {object} transforms - The transform options object
 * @return {array}
 */
async function transformImage(filepath, filename, transforms) {

	const image = await jimp.read(filepath)
	const files = []

	for (const key in transforms) {

		const transform = transforms[key]

		// ++ resize
		if (transform.width && transform.height) await image.resize(transform.width, transform.height)

		else if (transform.width) await image.resize(transform.width, jimp.AUTO)

		else if (transform.height) await image.resize(jimp.AUTO, transform.height)

		// ++ blur
		if (transform.blur) await image.blur(transform.blur)

		// ++ write files
		const _filepath = `${TEMP_DIR}/${filename}_${key}`

		await image.writeAsync(_filepath)

		files.push(_filepath)

		// ++ compression
		await imagemin(files, {

			destination: `${TEMP_DIR}/`,
			plugins    : [mozjpeg(), pngquant()],
			quality    : transform.quality || 100
		})
	}

	return files
}

/**
 * Nearest Aspect Ratio calculator for images
 * @param {string} filepath - The input filepath
 * @param {integer} maxWidth - The maximum width in the nearest normal aspect ratio (optional)
 * @param {integer} maxWidth - The maximum height in the nearest normal aspect ratio (optional)
 * @return {string}
 */
async function nearestImageAspectRatio(filepath, maxWidth = 16, maxHeight = 16) {

	const image = await jimp.read(filepath)
	// get image dimensions
	let width  = image.bitmap.width
	let height = image.bitmap.height

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

export {

	validateImage,
	transformImage,
	nearestImageAspectRatio
}
