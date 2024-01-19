/**
 * AWS
 */

import fs from 'fs'
import mimes from 'mime-types'
import {
	S3Client,
	PutObjectCommand,
	UploadPartCommand,
	CreateMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3'

// ++ consts
const DEFAULT_CHUCK_SIZE = 50*1024*1024 // 50 MB for chunk size

/**
 * Get S3 client
 * @param {string} region - The client region
 * @returns {object}
 */
function getClient(region) {

	const opts = {}

	if (parseInt(process.env.AWS_S3_TRANSFER_ACCELERATION))
		opts.useAccelerateEndpoint = true

	return new S3Client({ region, ...opts })
}

/**
 * Upload a resource to S3
 * @param {object} option - The input options
 * @param {array} files - The files array
 * @returns {array} - The output URLs
 */
async function uploadToS3({ bucketName, basePath, region, maxAge, acl }, files = []) {

	if (!files.length) return

	// common params
	const params = {

		Bucket      : bucketName,
		CacheControl: `max-age=${maxAge || 31_540_000}`, // 1 year default
	}
	// set ACL?
	if (acl) params.ACL = acl

	const urls = []
	for (const { path, filename, mimetype } of files) {

		try {

			// check size & upload strategy
			const { size } = fs.statSync(path)
			// get extension
			const extension = mimes.extension(mimetype)

			// set params key path
			params.Key = `${basePath}${filename}.${extension}`
			// set params content-type
			params.ContentType = mimetype

			// 100 MB bucket constraint
			const location = size/1024/1024 <= 100 ? await putObject(path, region, params) : await multipartUpload(path, region, params)
			// push resource URL
			urls.push(location)
		}
		catch (e) {

			console.error(`Aws (uploadToS3) -> upload failed ${filename}`, e.toString())
			throw e
		}
	}

	return urls
}

/**
 * PUT object upload
 * @param {string} path - The input file path
 * @param {string} region - The AWS region
 * @param {object} params - The command params
 * @returns {string} - The output URL
 */
async function putObject(path, region, params) {

	// S3 instance
	const client = getClient(region)

	// set body
	params.Body = fs.readFileSync(path)

	const { ETag } = await client.send(new PutObjectCommand(params))
	if (!ETag) throw 'PUT_UPLOAD_UNEXPECTED_RESPONSE'

	return getS3URL(region, params.Bucket, params.Key)
}

/**
 * Multipart Upload
 * @param {string} path - The input file path
 * @param {string} region - The AWS region
 * @param {object} params - The command params
 * @returns {string} - The output URL
 */
async function multipartUpload(path, region, params) {

	// S3 instance
	const client = getClient(region)

	const { UploadId } = await client.send(new CreateMultipartUploadCommand(params))
	if (!UploadId) throw 'MULTIPART_UPLOAD_UNEXPECTED_RESPONSE_UPLOAD_ID'

	// set UploadId
	console.log(`Aws (multipartUpload) -> multipart created, UploadId: ${UploadId}`)
	params.UploadId = UploadId

	try {
		// read stream
		const stream = fs.createReadStream(path)
		// trigger chunks upload
		const multipart = await multipartStream(stream, client, params, DEFAULT_CHUCK_SIZE)

		console.log(`Aws (multipartUpload) -> all chunks upload (${multipart.Parts.length}), completing multipart upload ...`)

		// set MultipartUpload
		params.MultipartUpload = multipart

		const { ETag } = await client.send(new CompleteMultipartUploadCommand(params))
		if (!ETag) throw 'MULTIPART_UPLOAD_UNEXPECTED_RESPONSE_LOCATION'

		console.log(`Aws (multipartUpload) -> upload completed, ETag: ${ETag}, Key: ${params.Key}`)
		// get location
		return getS3URL(region, params.Bucket, params.Key)
	}
	catch (e) {

		console.error(`Aws (multipartUpload) -> upload failed, UploadId: ${params.UploadId}`)
		// abort multipart upload
		await client.send(new AbortMultipartUploadCommand(params))
	}
}

/**
 * Multipart Upload (Promise)
 * @param {object} stream - The read stream
 * @param {object} client - The AWS client object
 * @param {object} params - The command params
 * @param {string} chunkSize - The chunk size
 * @returns {string} - The output URL
 */
function multipartStream(stream, client, { Bucket, Key, UploadId }, chunkSize) {

	return new Promise((resolve, reject) => {

		const parts = []

		let partNumber = 1
		let chunkAccumulator = null

		// on error
		stream.on('error', e => reject(e))
		// on data
		stream.on('data', async chunk => {

			chunkAccumulator = chunkAccumulator === null ? chunk : Buffer.concat([chunkAccumulator, chunk])

			if (chunkAccumulator.length <= chunkSize) return

			// pause the stream to upload this chunk to S3
			stream.pause()

			const chunkMB = parseFloat(chunkAccumulator.length/1024/1024).toFixed(2)
			const partParams = {

				Bucket,
				Key,
				UploadId,
				PartNumber   : partNumber,
				Body         : chunkAccumulator,
				ContentLength: chunkAccumulator.length
			}

			try {

				// upload part command
				const { ETag } = await client.send(new UploadPartCommand(partParams))
				console.log(`Aws (multipartStream) -> chunk uploaded, Part: ${partParams.PartNumber}, ETag: ${ETag}, Size: ${chunkMB} MB`)

				parts.push({ ETag, PartNumber: partParams.PartNumber })
				chunkAccumulator = null
				partNumber++
				// resume to read the next chunk
				stream.resume()
			}
			catch (e) {

				console.error(`Aws (multipartStream) -> error uploading chunk to S3: ${e.toString()}`)
				reject(e)
			}
		})
		// on close
		stream.on('close', async () => {

			if (!chunkAccumulator) return

			const chunkMB = parseFloat(chunkAccumulator.length/1024/1024).toFixed(2)
			const partParams = {

				Bucket,
				Key,
				UploadId,
				PartNumber   : partNumber,
				Body         : chunkAccumulator,
				ContentLength: chunkAccumulator.length
			}

			try {

				// upload part command
				const { ETag } = await client.send(new UploadPartCommand(partParams))
				console.log(`Aws (multipartStream) -> last chunk uploaded, Part: ${partParams.PartNumber}, ETag: ${ETag}, Size: ${chunkMB} MB`)

				parts.push({ ETag, PartNumber: partParams.PartNumber })
				chunkAccumulator = null

				resolve({ Parts: parts })
			}
			catch (e) {

				console.error(`Aws (multipartStream) -> error uploading last chunk to S3: ${e.toString()}`)
				reject(e)
			}
		})
	})
}

/**
 * Get S3 URL
 * @param {string} region - The AWS region
 * @param {string} bucketName - The bucket name
 * @param {string} key - The object key
 * @returns {string}
 */
function getS3URL(region, bucketName, key) {

	// default
	if (region == 'us-east-1') return `https://${bucketName}.s3.amazonaws.com/${key}`

	return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`
}

/**
 * Export
 */
export {

	uploadToS3
}
