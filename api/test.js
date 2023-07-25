/**
 * Test
 */

import imagemin from 'imagemin'
import mozjpeg  from 'imagemin-mozjpeg'
import pngquant from 'imagemin-pngquant'
import jimp     from 'jimp'
import fs       from 'fs'

const TEMP_DIR = 'tmp'

/**
 * Test jimp & imagemin
 */
async function resize(req, res) {

	if (process.env.NODE_ENV == 'production') return res.sendStatus(403)

	console.log('Test (resize) -> processing sample...'), console.time(`test-resize`)

	const imageJpg = await jimp.read('sample/lena.jpg')
	const imagePng = await jimp.read('sample/lena.png')

	await imageJpg.resize(150, jimp.AUTO)
	await imagePng.blur(8)

	await imageJpg.writeAsync('sample/lena-transform.jpg')
	await imagePng.writeAsync('sample/lena-transform.png')

	await imagemin(['sample/*.{jpg,png}'], {

		destination: `${TEMP_DIR}/`,
		plugins    : [mozjpeg(), pngquant()],
		quality    : 90
	})

	// clean cached file
	fs.unlinkSync('sample/lena-transform.jpg')
	fs.unlinkSync('sample/lena-transform.png')

	console.log(`Test (resize) -> Done`), console.timeEnd(`test-resize`)

	res.json({ status: 'ok' })
}

export {

	resize
}
