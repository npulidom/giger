/**
 * Test
 */

import imagemin from 'imagemin'
import mozjpeg  from 'imagemin-mozjpeg'
import pngquant from 'imagemin-pngquant'
import webp     from 'imagemin-webp'
import sharp    from 'sharp'
import fs       from 'fs'

const TEMP_DIR = 'tmp'

/**
 * Resize Images Test
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function resize(req, res) {

	if (process.env.NODE_ENV == 'production') return res.sendStatus(403)

	console.log('Test (resize) -> processing sample ...'), console.time('test-resize')

	const imageJpg = sharp('sample/lena.jpg')
	const imagePng = sharp('sample/lena.png')

	await imageJpg.resize({ width: 300 })
	await imagePng.resize({ width: 300 })
	//await imagePng.blur(8)

	await imageJpg.toFile('sample/lena-transform.jpg')
	await imagePng.toFile('sample/lena-transform.png')

	await imagemin(['sample/lena-transform.jpg'], { destination: `${TEMP_DIR}/`, plugins: [mozjpeg({ quality: 10 })] })
	await imagemin(['sample/lena-transform.png'], { destination: `${TEMP_DIR}/`, plugins: [pngquant({ quality: [.1, .2] })] })
	await imagemin(['sample/lena-transform.jpg'], { destination: `${TEMP_DIR}/`, plugins: [webp({ quality: 10 })] })

	// clean cached file
	fs.unlinkSync('sample/lena-transform.jpg')
	fs.unlinkSync('sample/lena-transform.png')

	console.log(`Test (resize) -> Done`), console.timeEnd('test-resize')

	res.json({ status: 'ok' })
}

export {

	resize
}
