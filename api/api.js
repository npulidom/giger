/**
 * API
 */

import fs from 'fs'
import mime from 'mime-types'
import { CronJob } from 'cron'

import * as mongo from './mongo.js'
import * as aws   from './aws.js'
import * as utils from './utils.js'

const TEMP_DIR = 'tmp'

/**
 * Cron instance
 */
let CRON

/**
 * Initial Setup
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
 */
async function upload(req, res) {

	const { file } = req
	const { profile = 'default', key = 0, tag = 0 } = req.params

	// input validation
	try {

		if (!file || file.fieldname != 'file') throw 'MISSING_FILE'

		// get metadata
		const meta = await mongo.getMeta(profile, key)

		if (!meta?.bucket) throw 'BUCKET_METADATA_NOT_FOUND'
		if (!meta?.objects?.[key]) throw 'OBJECT_METADATA_NOT_FOUND'

		// get upload profile object
		const objectMeta = meta.objects[key]

		if (!Array.isArray(objectMeta.mimeTypes)) throw 'OBJECT_MIME_TYPES_NOT_DEFINED'

		if (!file.mimetype || !objectMeta.mimeTypes.includes(file.mimetype)) throw 'FILE_NOT_SUPPORTED'

		// image validations
		if (file.mimetype.match(/image/) && objectMeta.constraints) await utils.validateImage(file.path, objectMeta.constraints)

		// get nearest aspect ratio
		const ratio = file.mimetype.match(/image/) ? await utils.nearestImageAspectRatio(file.path) : null

		// rename filename with tag?
		if (tag != 0) renameFile(file, tag)

		console.log('Api (upload) -> processing new upload', file.filename), console.time(`process-${file.filename}`)

		// image transforms
		let files = [file.path]

		if (file.mimetype.match(/image/) && objectMeta.transforms)
			files = files.concat(await utils.transformImage(file.path, file.filename, objectMeta.transforms))

		// extend meta props
		meta.bucket.basePath = (meta.bucket.basePath || '') + (objectMeta.bucketPath || '')
		meta.key             = key
		meta.extension       = mime.extension(file.mimetype).replace('jpeg', 'jpg')
		meta.mime            = file.mimetype
		meta.acl             = objectMeta.acl || 'public-read'
		meta.cacheControl    = `max-age=${objectMeta.maxAge || 31_536_000}`
		meta.async           = objectMeta.async || false
		// clean unnecessary data
		delete meta.objects

		// store files
		const urls = await storeFiles(meta, files)

		console.log('Api (upload) -> completed process', file.filename), console.timeEnd(`process-${file.filename}`)

		const body = { status: 'ok', urls }

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
 */
async function storeFiles(meta, files) {

	// for async S3 upload
	if (meta.async) {

		console.log('Api (storeFiles) -> async push', files[0])

		const key = meta.key + '-' + files[0].replace(`${TEMP_DIR}/`, '')

		// save pending upload in db
		await mongo.insertAsyncUpload({ key, meta, files, status: 'pending', createdAt: new Date() })

		// start cron if is not running
		if (!CRON.running) CRON.start()

		return [key]
	}

	// bucket upload
	const urls = await aws.uploadToS3(meta, files)
	// remove local file
	removeFile(files[0])

	return urls
}

/**
 * Process Async Upload
 */
async function processAsyncUploads() {

	try {

		console.log('Api (processAsyncUploads) -> tick execution ...')

		const pendingUploads = await mongo.getAsyncUploads({ status: 'pending' })

		for (const { _id, meta, files } of pendingUploads) {

			try {

				console.log(`Api (processAsyncUploads) -> pushing to S3: ${files[0]}`)

				// lock status
				await mongo.updateAsyncUpload(_id, { status: 'uploading' })

				// push to S3
				const urls = await aws.uploadToS3(meta, files)
				// remove local file
				removeFile(files[0])

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
 */
function removeFile(file) {

	if (!file || !file.startsWith(`${TEMP_DIR}/`)) return

	file = file.substring(4)

	console.log(`Api (removeFile) -> removing temp file`, file)

	fs.readdirSync(TEMP_DIR).filter(f => f.match(new RegExp(file, 'g'))).map(f => fs.unlinkSync(`${TEMP_DIR}/${f}`))
}

/**
 * Remove Limbo files that couldn't be removed
 */
function removeLimboFiles() {

	const files = fs.readdirSync(TEMP_DIR).filter(f => f.length >= 32)

	for (const file of files) {

		try {

			const { mtime } = fs.statSync(`${TEMP_DIR}/${file}`)

			if (!mtime) continue

			const diff = new Date().valueOf() - new Date(mtime).valueOf()

			// 12 hours
			if (diff >= 43_200_000) removeFile(`${TEMP_DIR}/${file}`)
		}
		catch (e) { console.warn(`Api (removeLimboFiles) -> failed reading file ${file}`, e.toString()) }
	}
}

export {

	setup,
	upload,
}
