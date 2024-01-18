/**
 * Test
 */

import fs    from 'fs'
import sharp from 'sharp'

import * as api from './api.js'

// ++ consts
const TEMP_DIR = 'tmp'

/**
 * Resize Images Test
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function resize(req, res) {

	console.time('test-resize')

	try {

		const file    = { path: 'sample/lena.jpg', filename: 'lena', mimetype: 'image/jpeg' }
		const profile = 'default'
		const object  = 'avatar'
		const tag     = '0'

		const result = await api.processFile(file, profile, object, tag)

		res.json({ status: 'ok', ...result })
	}
	catch (e) {

		console.error(`Test (resize) -> exception`, e)
		res.json({ status: 'error', error: e.toString() })
	}

	console.timeEnd('test-resize')
}

/**
 * Export
 */
export {

	resize
}
