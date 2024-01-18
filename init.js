/**
 * Init
 */

import express from 'express'
import multer  from 'multer'
import { URL } from 'url'

import * as api  from './api/api.js'
import * as test from './api/test.js'

// ++ consts
const VERSION = process.env.BUILD_ID
const TEMP_DIR = 'tmp'

// ++ props
let server

/**
 * Init
 * @returns {undefined}
 */
async function init() {

	// ++ API setup
	await api.setup()

	// ++ multer upload handler
	const uploader = multer({ dest: `${TEMP_DIR}/`, limits: { fileSize: process.env.MAX_FILE_SIZE || Infinity } }) // bytes

	// ++ express setup
	const app = express()
	// trust proxy
	app.set('trust proxy', 1)
	// json support
	app.use(express.json())
	// disable X-Powered-By response header
	app.disable('x-powered-by')

	/**
	 * Express Interceptor
	 */
	app.use((req, res, next) => {

		if (req.path.match(/health/)) return next()

		// CORS allowed origin
		if (process.env.ALLOWED_ORIGINS) {

			try {

				const { protocol, host } = new URL(req.get('Origin') || req.get('Referer'))
				const whitelist = process.env.ALLOWED_ORIGINS.split(',').map(o => new URL(o).host)

				// check Origin header if present
				if (whitelist.includes(host)) {

					res.set('Access-Control-Allow-Origin', `${protocol}//${host}`)
					res.set('Vary', 'Origin')
				}
			}
			catch (e) { return res.sendStatus(403) }
		}
		else res.set('Access-Control-Allow-Origin', '*')

		// CORS allowed headers
		res.set('Access-Control-Allow-Headers', 'Content-Type, Origin, X-Requested-With, X-Api-Key')

		// for preflight requests
		if (req.method.match(/OPTIONS/)) return res.sendStatus(200)

		// validate API_KEY
		if (process.env.API_KEY && process.env.API_KEY != req.get('X-Api-Key'))
			return res.status(401).json({ status: 'error', msg: 'unauthorized' })

		next()
	})

	/**
	 * GET - Health check
	 */
	app.get('*/health', (req, res) => res.sendStatus(200))

	/**
	 * POST - Upload
	 */
	app.post([

		'*/upload/:profile/:object',
		'*/upload/:profile/:object/:tag',

	], uploader.single('file'), (req, res) => api.upload(req, res))

	/**
	 * GET - Test Resize
	 */
	if (process.env.NODE_ENV == 'development')
		app.get('*/test/resize', (req, res) => test.resize(req, res))

	/**
	 * Not Found
	 */
	app.use((req, res, next) => res.status(404).send({ status: 'error', msg: 'service not found' }))

	// ++ start server
	server = await app.listen(80)
	console.log(`Init -> server up at ${new Date().toString()}, version: ${VERSION}`)
}

/**
 * Gracefull exit
 * @param {string} signal - The signal
 * @returns {undefined}
 */
async function exitGracefully(signal) {

	if (server) await server.close()

	console.log(`Init (exitGracefully) -> ${signal} signal event`)
	process.exit(0)
}

// process signal events
process.on('SIGINT', exitGracefully)
process.on('SIGTERM', exitGracefully)

// start app
try { await init() }
catch (e) { console.error('Init -> main exception:', e) }
