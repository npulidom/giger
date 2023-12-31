/**
 * API
 */

import fs from 'fs'
import { CronJob } from 'cron'

import * as mongo from './mongo.js'
import * as aws   from './aws.js'
import * as utils from './utils.js'

// ++ consts
const TEMP_DIR = 'tmp'

/**
 * Cron instance
 */
let CRON

/**
 * Initial Setup
 * @returns {undefined}
 */
async function setup() {

	await mongo.connect()

	// start/stop manually (every 30 secs)
	CRON = new CronJob('0/30 * * * * *', async () => await processAsyncUploads(), null, false)
	// active cron for file cleaning (every 12 hours)
	new CronJob('0 0 */12 * * *', () => removeLimboFiles(), null, true)
}

/**
 * Upload
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function upload(req, res) {

	const { file } = req
	const { profile = 'default', object = '', tag = 0 } = req.params

	// input validation
	try {

		if (!file || file.fieldname != 'file') throw 'MISSING_FILE'

		// get metadata
		const meta = await mongo.getMeta(profile, object)

		if (!meta?.bucket) throw 'BUCKET_OBJECT_METADATA_NOT_FOUND'

		// get upload profile object
		const objectMeta = meta.objects[object]

		if (!Array.isArray(objectMeta.mimeTypes)) throw 'OBJECT_MIME_TYPES_NOT_DEFINED'

		if (!file.mimetype || !objectMeta.mimeTypes.includes(file.mimetype)) throw 'FILE_NOT_SUPPORTED'

		// image validations
		if (file.mimetype.match(/image/) && objectMeta.constraints) await utils.validateImage(file.path, objectMeta.constraints)

		// get nearest aspect ratio
		const ratio = file.mimetype.match(/image/) ? await utils.nearestImageAspectRatio(file.path) : null

		// rename filename with tag?
		if (tag != 0) renameFile(file, tag)

		console.log('Api (upload) -> processing new upload', file.filename), console.time(`process-${file.filename}`)

		// source image
		let files = [{ file: file.path, mimetype: file.mimetype }]

		// image transforms
		if (file.mimetype.match(/image/) && Array.isArray(objectMeta.transforms)) {

			files = files.concat(await utils.transformImage(file.path, file.filename, objectMeta.transforms, objectMeta.outputFormat))
		}

		// extend meta props
		meta.keyPrefix    = (meta.bucket.basePath || '') + (objectMeta.bucketPath || '') + object
		meta.acl          = objectMeta.acl || 'public-read'
		meta.cacheControl = `max-age=${objectMeta.maxAge || 31_536_000}`
		meta.async        = objectMeta.async || false
		// clean unnecessary data
		delete meta.objects

		// store files
		const result = await storeFiles(meta, files)

		console.log('Api (upload) -> completed process', file.filename), console.timeEnd(`process-${file.filename}`)

		const body = { status: 'ok', ...result }

		// append aspect ratio in response
		if (ratio) body.ratio = ratio

		res.json(body)
	}
	catch (e) {

		console.error('Api (upload) -> exception', e)
		// remove local file
		if (file) removeFile(file.path)

		res.json({ status: 'error', error: e.toString() })
	}
}

/**
 * Store Files in S3
 * @param {object} meta - The profile metadata options
 * @param {array} files - The input files
 * @returns {array}
 */
async function storeFiles(meta, files) {

	const src = files[0]

	// for async S3 upload
	if (meta.async) {

		console.log(`Api (storeFiles) -> async push: ${JSON.stringify(src)}`)

		// remove some props
		delete meta._id

		// save pending upload in db
		const _id = await mongo.insertAsyncUpload({ meta, files, status: 'pending', createdAt: new Date() })

		// start cron if is not running
		if (!CRON.running) CRON.start()

		return { _id, ...src }
	}

	// bucket upload
	const urls = await aws.uploadToS3(meta, files)
	// remove local file
	removeFile(src.file)

	return { urls }
}

/**
 * Process Async Upload
 * @returns {undefined}
 */
async function processAsyncUploads() {

	try {

		console.log('Api (processAsyncUploads) -> tick execution ...')

		const pendingUploads = await mongo.getAsyncUploads({ status: 'pending' })

		for (const { _id, meta, files } of pendingUploads) {

			try {

				console.log(`Api (processAsyncUploads) -> pushing to S3: ${JSON.stringify(files)}`)

				// lock status
				await mongo.updateAsyncUpload(_id, { status: 'uploading' })

				// push to S3
				const urls = await aws.uploadToS3(meta, files)

				const src = files[0]

				// remove local file
				removeFile(src.file)

				await mongo.updateAsyncUpload(_id, { urls, status: 'success' })
			}
			catch (e) {

				await mongo.updateAsyncUpload(_id, { status: 'failed', error: e.toString() })
			}
		}

		// stop cron if there's no pending uploads
		if (!await mongo.countAsyncUploads({ status: 'pending' })) {

			console.log('Api (processAsyncUploads) -> no pending uploads, stopping cron ...')
			CRON.stop()
		}
	}
	catch (e) { console.error('Api (processAsyncUploads) -> exception', e) }
}

/**
 * Rename File
 * @param {string} file - The input file
 * @param {string} newFilename - The new filename
 * @returns {undefined}
 */
function renameFile(file, newFilename) {

	if (!file || !file.path) return

	const newPath = file.path.replace(file.filename, newFilename)

	// rename file
	fs.renameSync(file.path, newPath)

	file.filename = newFilename
	file.path     = newPath
}

/**
 * Remove File
 * @param {string} file - The input file
 * @returns {undefined}
 */
function removeFile(file) {

	const tempDir = `${TEMP_DIR}/`

	if (!file || !file.startsWith(tempDir)) return

	file = file.substring(tempDir.length)

	console.log(`Api (removeFile) -> removing temp file: ${file}`)

	fs.readdirSync(TEMP_DIR).filter(f => f.match(new RegExp(file, 'g'))).map(f => fs.unlinkSync(`${TEMP_DIR}/${f}`))
}

/**
 * Remove Limbo files that couldn't be removed
 * @returns {undefined}
 */
function removeLimboFiles() {

	// filter in size
	const files = fs.readdirSync(TEMP_DIR).filter(f => f.length >= 32)

	for (const file of files) {

		try {

			const { mtime } = fs.statSync(`${TEMP_DIR}/${file}`)

			if (!mtime) continue

			const diff = new Date().valueOf() - new Date(mtime).valueOf()

			// 12 hours expiry
			if (diff >= 43_200_000) removeFile(`${TEMP_DIR}/${file}`)
		}
		catch (e) { console.warn(`Api (removeLimboFiles) -> failed reading file ${file}`, e.toString()) }
	}
}

/**
 * Export
 */
export {

	setup,
	upload,
}
