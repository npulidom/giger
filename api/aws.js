/**
 * AWS
 */

import fs from 'fs'
import mimes from 'mime-types'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from "@aws-sdk/lib-storage"

// ++ consts
const MULTIPART_CHUCK_SIZE = 50*1024*1024 // 50 MB for chunk size

/**
 * Get S3 client
 * @param {string} region - The client region
 * @returns {object}
 */
function getClient(region) {

	return new S3Client({ region })
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
			if (size/1024/1024 <= 100)
				urls.push(await putObject(path, region, params))
			else
				urls.push(await multipartUpload(path, region, params))
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

	try {

		console.log(`Aws (multipartUpload) -> new multipart upload: ${path}`)

		// read stream
		const stream = fs.createReadStream(path)
		// set body buffer
		params.Body = stream

		// trigger multipart upload
		const uploads = new Upload({

			client,
			params,
			queueSize: 2,
			partSize: MULTIPART_CHUCK_SIZE,
			leavePartsOnError: false
		})
		// progress listener
		uploads.on(`httpUploadProgress`, progress => console.log(`Aws (multipartUpload) -> upload-progress file: ${path}`, progress))

		// trigger chunk uploads
		await uploads.done()

		console.log(`Aws (multipartUpload) -> multipart upload completed: ${path}`)

		// get location
		return getS3URL(region, params.Bucket, params.Key)
	}
	catch (e) {

		console.error(`Aws (multipartUpload) -> multipart upload failed: ${path}`, e.toString())
		throw e
	}
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
