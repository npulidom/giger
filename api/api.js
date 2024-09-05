/**
 * API
 */

import { CronJob } from 'cron'

import * as mongo from './mongo.js'
import * as aws   from './aws.js'
import * as utils from './utils.js'

/**
 * Suported image output formats
 * @constant {array} SUPPORTED_OUTPUT_FORMATS - The supported image output formats
 */
const SUPPORTED_OUTPUT_FORMATS = ['webp', 'avif', 'jpeg', 'png']

/**
 * Cron instance
 * @property {object} CRON - The cron instance
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
	new CronJob('0 0 */12 * * *', () => utils.removeLimboFiles(), null, true)
}

/**
 * Upload
 * @param {object} req - The request object
 * @param {object} res - The response object
 * @returns {undefined}
 */
async function upload(req, res) {

	try {

		const { file } = req
		const { profile = 'default', object = '', tag = 0 } = req.params

		// input validation
		if (!file || file.fieldname != 'file') throw 'MISSING_FILE'
		if (!object) throw 'MISSING_OBJECT_PARAM'

		const result = await processFile(file, profile, object, tag)

		res.json({ status: 'ok', ...result })
	}
	catch (e) {

		console.error('Api (upload) -> exception', e)
		res.status(418).json({ status: 'error', error: e.toString() })
	}
}

/**
 * Process File
 * @param {object} file - The input file
 * @param {string} profile - The upload profile
 * @param {string} objectName - The object name in the profile
 * @param {string} tag - An optional tag to rename the input file
 * @returns {object}
 */
async function processFile({ path, filename, mimetype }, profile, objectName, tag) {

	try {

		// get metadata
		const meta = await mongo.getMeta(profile, objectName)
		if (!meta?.bucket) throw 'METADATA_BUCKET_OBJECT_NOT_FOUND'

		// get profile object
		const objectMeta = meta.objects[objectName]

		if (!Array.isArray(objectMeta.mimeTypes)) throw 'OBJECT_MIME_TYPES_NOT_DEFINED'

		if (!mimetype || !objectMeta.mimeTypes.includes(mimetype)) throw `FILE_NOT_SUPPORTED:${mimetype}`

		// image validations
		if (mimetype.match(/image/) && objectMeta.constraints)
			await utils.validateImage(path, objectMeta.constraints)

		// get nearest aspect ratio
		const ratio = mimetype.match(/image/) ? await utils.nearestImageAspectRatio(path) : null

		// rename file with tag?
		if (tag != 0) {

			const { path: newPath, filename: newFilename } = utils.renameFile({ path, filename }, tag)

			path     = newPath
			filename = newFilename
		}

		console.log('Api (processFile) -> processing new file', filename), console.time(`process-file_${filename}`)

		const files = [{ path, filename, mimetype }]

		// image transforms
		if (mimetype.match(/image/) && objectMeta.transforms?.length) {

			const outputFormat = objectMeta.outputFormat || mimetype.substring(mimetype.indexOf('/') + 1)

			if (!SUPPORTED_OUTPUT_FORMATS.includes(outputFormat)) throw `INVALID_OUTPUT_FORMAT:${outputFormat}`

			files.push(...await utils.transformImage(files[0], objectMeta.transforms, outputFormat))
		}

		// set S3 options
		const options = {

			region    : meta.bucket.region || 'us-east-1',
			bucketName: meta.bucket.name,
			basePath  : utils.joinPath(meta.bucket.basePath, objectMeta.bucketPath, `${objectName}-`),
			cloudfront: meta.bucket.cloudfront || null,
			maxage    : objectMeta.maxage,
			acl       : objectMeta.acl,
		}

		// store files
		const result = await storeFiles(options, files, objectMeta.async || false)
		// append aspect ratio?
		if (ratio) result.ratio = ratio

		console.log('Api (processFile) -> completed process', filename), console.timeEnd(`process-file_${filename}`)
		return result
	}
	catch (e) {

		// remove local file
		utils.removeFile(filename)
		throw e
	}
}

/**
 * Store Files in S3
 * @param {object} options - The input options
 * @param {array} files - The input files
 * @param {boolean} async - Async mode
 * @returns {array}
 */
async function storeFiles(options, files, async) {

	const src = files[0]

	// async mode (wait response)?
	if (async) {

		console.log(`Api (storeFiles) -> async-mode, src=${JSON.stringify(src)}`)

		// save pending upload in db
		const _id = await mongo.insertAsyncUpload({ options, files, status: 'pending', createdAt: new Date() })

		// start cron if is not running
		if (!CRON.running) CRON.start()

		return { _id, ...src }
	}

	// bucket upload
	const urls = await aws.uploadToS3(options, files)
	// remove local file
	utils.removeFile(src.filename)

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

		for (const { _id, options, files } of pendingUploads) {

			try {

				console.log(`Api (processAsyncUploads) -> pushing to S3, files=${JSON.stringify(files)}`)

				// lock status
				await mongo.updateAsyncUpload(_id, { status: 'uploading' })
				// push to S3
				const urls = await aws.uploadToS3(options, files)

				// remove local file
				utils.removeFile(files[0].filename)

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
 * Export
 */
export {

	setup,
	upload,
	processFile,
}
