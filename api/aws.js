/**
 * AWS
 */

import fs from 'fs'
import mimes from 'mime-types'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from "@aws-sdk/lib-storage"

/**
 * Multipart Chuck Size
 * @constant {number} MULTIPART_CHUCK_SIZE - The multipart chunk size
 */
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
async function uploadToS3({ region, bucketName, basePath, cloudfront, maxAge, acl }, files = []) {

	if (!files.length) return

	// common params
	const params = {

		Bucket      : bucketName,
		CacheControl: `max-age=${maxAge || 31_540_000}`, // 1 year default
	}
	// set ACL?
	if (acl) params.ACL = acl

	// check if basePath
	if (basePath && basePath.startsWith('/'))
		basePath = basePath.substring(1)

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

			console.error(`Aws (uploadToS3) -> upload failed, filename=${filename}`, e.toString())
			throw e
		}
	}

	// use Cloudfront URLs?
	if (cloudfront?.url)
		return toCloudFrontURLs(urls, cloudfront.url, cloudfront.excludePath)

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

		console.log(`Aws (multipartUpload) -> new multipart upload, filepath=${path}`)

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
		uploads.on(`httpUploadProgress`, progress => console.log(`Aws (multipartUpload) -> upload-progress, filepath=${path}`, progress))

		// trigger chunk uploads
		await uploads.done()

		console.log(`Aws (multipartUpload) -> multipart upload completed, filepath=${path}`)

		// get location
		return getS3URL(region, params.Bucket, params.Key)
	}
	catch (e) {

		console.error(`Aws (multipartUpload) -> multipart upload failed, filepath=${path}`, e.toString())
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
 * Converts a list of S3 URLs to CloudFront URLs
 * @param {array} urls - The list of S3 URLs
 * @param {string} cloudfrontUrl - The CloudFront URL
 * @param {string} excludePath - S3 path to exclude (optional)
 * @returns {undefined}
 */
function toCloudFrontURLs(urls, cloudfrontUrl, excludePath = '') {

	// remove ending slash?
	if (cloudfrontUrl.endsWith('/'))
		cloudfrontUrl = cloudfrontUrl.substring(0, cloudfrontUrl.length - 1)

	// remove ending slash?
	if (excludePath.endsWith('/'))
		excludePath = excludePath.substring(0, excludePath.length - 1)

	// remove starting slash?
	if (excludePath.startsWith('/'))
		excludePath = excludePath.substring(1)

	return urls.map(url => {

		try {

			// get path from URL
			let { pathname } = new URL(url)

			// exclude path?
			if (excludePath) pathname = pathname.replace(excludePath, '')

			// clean concatenated slashes
			pathname = pathname.replace(/\/{2,}/g, '/')

			// append slash?
			if (!pathname.startsWith('/')) pathname = `/${pathname}`

			return `${cloudfrontUrl}${pathname}`
		}
		catch (e) { return url }
	})
}

/**
 * Export
 */
export {

	uploadToS3
}
