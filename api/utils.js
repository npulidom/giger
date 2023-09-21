/**
 * Utils
 */

import imagemin from 'imagemin'
import mozjpeg  from 'imagemin-mozjpeg'
import pngquant from 'imagemin-pngquant'
import webp     from 'imagemin-webp'
import sharp    from 'sharp'
import mimes    from 'mime-types'

// ++ consts
const TEMP_DIR = 'tmp'

/**
 * Validate Image constraints
 * @param {string} filepath - The input filepath
 * @param {object} options - The validation options constraints
 * @returns {boolean}
 */
async function validateImage(filepath, { width, height, minWidth, minHeight, ratio }) {

	const image = await sharp(filepath).metadata()

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
 * @param {string} filepath - The absolute input filepath
 * @param {string} filename - The input filename for destination
 * @param {array} transforms - The transforms array
 * @param {array} outputFormat - The output format
 * @return {array}
 */
async function transformImage(filepath, filename, transforms = [], outputFormat) {

	console.time(`transform-image-${filename}`)

	const image       = sharp(filepath)
	const metadata    = await image.metadata()
	const destination = `${TEMP_DIR}/`
	const files       = []

	// validates output format
	if (!['jpeg', 'png', 'webp'].includes(outputFormat)) outputFormat = metadata.format

	const mimetype = mimes.lookup(outputFormat)

	for (const transform of transforms) {

		// ++ resize
		if (transform.width && transform.height) await image.resize({ width: transform.width, height: transform.height })

		else if (transform.width) await image.resize({ width: transform.width })

		else if (transform.height) await image.resize({ height: transform.height })

		// ++ blur
		if (transform.blur) await image.blur(transform.blur)

		// ++ write files
		let _filepath = `${TEMP_DIR}/${filename}_${transform.name}`
		await image.toFile(_filepath)

		// ++ compressions
		if (outputFormat == 'jpeg')
			await imagemin([_filepath], { destination, plugins: [mozjpeg({ quality: transform.quality || 100 })] })

		else if (outputFormat == 'webp')
			await imagemin([_filepath], { destination, plugins: [webp({ quality: transform.quality || 100 })] })

		else if (outputFormat == 'png') {

			const opts = Array.isArray(transform.quality) ? { quality: transform.quality } : {}

			await imagemin([_filepath], { destination, plugins: [pngquant(opts)] })
		}

		// push file
		files.push({ file: _filepath, mimetype })
	}

	console.timeEnd(`transform-image-${filename}`)

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

	const image = await sharp(filepath).metadata()
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
 * Export
 */
export {

	validateImage,
	transformImage,
	nearestImageAspectRatio
}
