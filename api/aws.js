/**
 * AWS
 */

import fs from 'fs'
import {
	S3Client,
	PutObjectCommand,
	UploadPartCommand,
	CreateMultipartUploadCommand,
	CompleteMultipartUploadCommand
} from '@aws-sdk/client-s3'

const TEMP_DIR = 'tmp'
const DEFAULT_CHUCK_SIZE = 50*1024*1024 // 50 MB for chunk size

/**
 * Get S3 client
 * @param {string} region - The client region
 * @returns {object}
 */
function getClient(region = 'us-east-1') {

	return new S3Client({ region })
}

/**
 * Upload a resource to S3
 * @param {object} meta - The metadata profile
 * @param {array} files - The files array
 * @returns {array} - The output URLs
 */
async function uploadToS3(meta, files = []) {

	if (!files.length) return

	// S3 instance
	const client = getClient(meta.bucket.region)
	// params
	const params = {

		Bucket      : meta.bucket.name,
		ACL         : meta.acl,
		CacheControl: meta.cacheControl,
		ContentType : meta.mime
	}
	//console.log('Aws (uploadToS3) -> pushing files', files, meta)

	const urls = []
	for (const file of files) {

		try {

			// check size & upload strategy
			const { size } = fs.statSync(file)

			// set params key path
			params.Key = `${meta.bucket.basePath + meta.key}-${file}.${meta.extension}`.replace(`${TEMP_DIR}/`, '')

			// 100 MB bucket constraint
			const location = size/1024/1024 <= 100 ? await putObject(client, params, file) : await multipartUpload(client, params, file)

			// push resource URL
			urls.push(location)
		}
		catch (e) {

			console.error(`Aws (uploadToS3) -> S3 upload failed [${file}]`, e.toString())
			throw e
		}
	}

	return urls
}

/**
 * PUT object upload
 * @param {object} client - The S3 client
 * @param {object} params - The command params
 * @param {string} file - The input file
 * @returns {string} - The output URL
 */
async function putObject(client, params, file) {

	// set body
	params.Body = fs.readFileSync(file)

	const { ETag } = await client.send(new PutObjectCommand(params))

	if (!ETag) throw 'PUT_UPLOAD_UNEXPECTED_RESPONSE'

	return getS3URL(await client.config.region(), params.Bucket, params.Key)
}

/**
 * Multipart Upload
 * @param {object} client - The S3 client
 * @param {object} params - The command params
 * @param {string} file - The input file
 * @returns {string} - The output URL
 */
async function multipartUpload(client, params, file) {

	const { UploadId } = await client.send(new CreateMultipartUploadCommand(params))

	if (!UploadId) throw 'MULTIPART_UPLOAD_UNEXPECTED_RESPONSE_UPLOAD_ID'

	// set UploadId
	params.UploadId = UploadId

	console.log(`Aws (multipartUpload) -> multipart created, UploadId: ${UploadId}`)

	// trigger chunks upload
	const multipart = await multipartStream(client, params, file, DEFAULT_CHUCK_SIZE)

	console.log(`Aws (multipartUpload) -> all parts upload (${multipart.Parts.length}), completing multipart upload ...`)

	params = {

		Bucket         : params.Bucket,
		Key            : params.Key,
		MultipartUpload: multipart,
		UploadId
	}

	let { ETag } = await client.send(new CompleteMultipartUploadCommand(params))

	if (!ETag) throw 'MULTIPART_UPLOAD_UNEXPECTED_RESPONSE_LOCATION'

	console.log(`Aws (multipartUpload) -> upload completed, ETag: ${ETag}, Key: ${params.Key}`)

	return getS3URL(await client.config.region(), params.Bucket, params.Key)
}

/**
 * Multipart Upload (Promise)
* @param {object} client - The S3 client
 * @param {object} params - The command params
 * @param {string} file - The input file
 * @param {string} chunkSize - The chunk size
 * @returns {string} - The output URL
 */
function multipartStream(client, { Bucket, Key, UploadId }, file, chunkSize) {

	return new Promise((resolve, reject) => {

		const multipartMap = { Parts: [] }

		let partNumber = 1
		let chunkAccumulator = null

		// read stream
		const stream = fs.createReadStream(file)

		// on error
		stream.on('error', e => reject(e))
		// on data
		stream.on('data', chunk => {

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

			// upload part command
			client.send(new UploadPartCommand(partParams))
			.then(({ ETag }) => {

				console.log(`Aws (multipartStream) -> data chunk uploaded, Part: ${partParams.PartNumber}, ETag: ${ETag}, Size: ${chunkMB} MB`)

				multipartMap.Parts.push({ ETag, PartNumber: partParams.PartNumber })
				chunkAccumulator = null
				partNumber++
				// resume to read the next chunk
				stream.resume()
			})
			.catch(e => {

				console.error(`Aws (multipartStream) -> error uploading chunk to S3: ${e.message}`)
				reject(e)
			})
		})
		// on close
		stream.on('close', () => {

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

			// upload part command
			client.send(new UploadPartCommand(partParams))
			.then(({ ETag }) => {

				console.log(`Aws (multipartStream) -> last data chunk uploaded, Part: ${partParams.PartNumber}, ETag: ${ETag}, Size: ${chunkMB} MB`)

				multipartMap.Parts.push({ ETag, PartNumber: partParams.PartNumber })
				chunkAccumulator = null

				resolve(multipartMap)
			})
			.catch(e => {

				console.error(`Aws (multipartStream) -> error uploading last chunk to S3: ${e.message}`)
				reject(e)
			})
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

export {

	uploadToS3
}
