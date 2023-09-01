/**
 * Mongo
 */

import { MongoClient } from 'mongodb'

// ++ Consts
const _COLLECTION = process.env.MONGO_COLLECTION || 'giger'
const COLLECTIONS = {

	default     : _COLLECTION,
	asyncUploads: `${_COLLECTION}AsyncUploads`
}

/**
 * DB instance
 */
let DB

/**
 * DB Connect
 * @returns {undefined}
 */
async function connect() {

	if (!process.env.MONGO_URL) throw 'MISSING_MONGO_URL_ENV_VAR'

	DB = (await MongoClient.connect(process.env.MONGO_URL, { useNewUrlParser: true, useUnifiedTopology: true })).db()
}

/**
 * Get Metadata
 * @param {string} profile - The profile name
 * @param {string} objectName - The object name
 * @returns {object}
 */
async function getMeta(profile, objectName) {

	const q = { name: profile }

	q[`objects.${objectName}`] = { $ne: null }

	return await DB.collection(COLLECTIONS.default).findOne(q)
}

/**
 * Get Async Uplaods
 * @param {object} query - The query object
 * @returns {array}
 */
async function getAsyncUploads(query = {}) {

	return await DB.collection(COLLECTIONS.asyncUploads).find(query).toArray()
}

/**
 * Get Count Async Uplaods
 * @param {object} query - The query object
 * @returns {int}
 */
async function countAsyncUploads(query = {}) {

	return await DB.collection(COLLECTIONS.asyncUploads).countDocuments(query)
}

/**
 * Get Async Uplaods
 * @param {object} doc - The document object
 * @returns {object}
 */
async function insertAsyncUpload(doc) {

	const { insertedId } = await DB.collection(COLLECTIONS.asyncUploads).insertOne(doc)

	return insertedId
}

/**
 * Update Async Uplaod
 * @param {object} _id - The document ID
 * @param {object} doc - The document object
 * @returns {object}
 */
async function updateAsyncUpload(_id, doc) {

	return await DB.collection(COLLECTIONS.asyncUploads).updateOne({ _id }, { $set: doc })
}

export {

	connect,
	getMeta,
	getAsyncUploads,
	countAsyncUploads,
	insertAsyncUpload,
	updateAsyncUpload,
}
