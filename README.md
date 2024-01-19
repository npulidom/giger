# Giger

Container service for image resize/compression with AWS S3 uploader (or S3 standalone uploads).
The service uses a MongoDB collection to read resize/upload operation, support multiples profiles.

- Resize images in multiple sizes.
- Validates image dimensions / aspect-ratio.
- Supports large files (more than 100 MB) with async upload (multipart).
- Built on NodeJs and Sharp (`libvips`).

## Images supported formats

- `webp`
- `avif`
- `jpeg`
- `png`

## Env-vars

```yml
MONGO_URL: MongoDB URL, required (i.e. mongodb://mongo/app)
MONGO_COLLECTION: Mongo collection name, default is 'giger' (optional)
ALLOWED_ORIGINS: CORS origin access (optional)
AWS_ACCESS_KEY_ID: AWS Access Key ID (optional)
AWS_SECRET_ACCESS_KEY: AWS Secret Access Key (optional)
API_KEY: API Key used as basic security. API Key must be passed as header 'X-Api-Key' (optional)
MAX_FILE_SIZE: The max file limit size in bytes for uploads, default is unlimited (optional)
```

## AWS Credentials

AWS credentials can be loaded from **env-vars**, but it's recommended to use IAM roles in production environment.

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Consider always to limit the permissions scope to the profile bucket.

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:GetObject",
                "s3:GetObjectAcl",
                "s3:PutObject",
                "s3:PutObjectAcl",
                "s3:ListBucket"
            ],
            "Resource": "arn:aws:s3:::my-bucket-name/*"
        }
    ]
}
```

## MongoDB JSON Struct

A collection with name `{MONGO_COLLECTION}` (default is `giger`) must be created with at least the `default` **profile**. See `sample/db.json`.

```javascript
{
    "name": "default", // required, the profile name
    "bucket": {

        "name": "my-bucket-name",
        "basePath": "giger", // optional, default is root
        "region": "us-east-1" // default is "us-east-1"
    },
    "objects": {

        "avatar": {

            "bucketPath": "avatars/",    // optional, must end with '/'
            "mimeTypes": ["image/jpeg"], // required, accepted mime-types ['image/jpeg','image/png', 'image/webp']
            "outputFormat": "webp",      // optional, default is same format as input image; options: webp, avif, jpeg, png
            "maxAge": 86400,             // optional, default is 1 year
            "acl": "public-read",        // optional, default is none (private)
            "async": false,              // optional, async multipart-upload for big files, the output URLs will be saved later in another collection
            "constraints": {

                "minWidth": 300,  // optional
                "minHeight": 300, // optional
                "ratio": "3/2"    // optional, aspect-ratio constraint
            },
            "transforms": [

                {
                    "name": "L",  // the thumbnail version name
                    "width": 300, // resize width, height is auto-calculated keeping aspect-ratio
                    "quality": 90 // quality 1-100
                },
                {
                    "name": "M",
                    "width": 150,
                    "quality": 80
                },
                {
                    "name": "S",
                    "width": 100,
                    "quality": 70
                },
                {
                    "name": "B",
                    "width": 100,
                    "quality": 21,
                    "blur": 8      // blur supported (pixels)
                }
            ]
        },
        // supports big files uploads
        "video": {

            "bucketPath": "videos/",
            "mimeTypes": ["video/mp4"],
            "maxAge": 86400,
            "async": true
        }
    }
}
```

## Usage

Run a container

```bash
docker run -p 8080:80 --env-file .env npulidom/giger
```

## Endpoints

### POST ./upload

```bash
[POST] multipart/form-data
Content-Disposition: form-data; name="file"; type="image/jpeg"; filename="some-picture.jpeg"

> https://{host}/upload/:profile/:object
> https://{host}/upload/:profile/:object/:tag

# examples
https://services.some-app.com/giger/upload/default/avatar
https://services.some-app.com/giger/upload/default/avatar/0
https://services.some-app.com/giger/upload/default/avatar/123456
```

- `profile` is the profile name, example `default`.
- `object` is the object name, example `avatar`.
- `tag` is an optional custom value to replace the auto-generated file name, set to **0** to keep the auto-generated file name or exclude param.

```bash
# output response ok
{
    "status": "ok",
    "urls": [
      "https://my-bucket-name.s3.amazonaws.com/giger/avatars/avatar-298434f20f0327aa83a30dc15f880fda.jpg",
      "https://my-bucket-name.s3.amazonaws.com/giger/avatars/avatar-298434f20f0327aa83a30dc15f880fda_L.jpg",
      "https://my-bucket-name.s3.amazonaws.com/giger/avatars/avatar-298434f20f0327aa83a30dc15f880fda_M.jpg",
      "https://my-bucket-name.s3.amazonaws.com/giger/avatars/avatar-298434f20f0327aa83a30dc15f880fda_S.jpg",
      "https://my-bucket-name.s3.amazonaws.com/giger/avatars/avatar-298434f20f0327aa83a30dc15f880fda_B.jpg"
    ],
    "ratio": "1:1"
}

# output response error
{
    "status": "error",
    "error": "SOME_ERROR"
}
```

### GET ./health

Service also includes a `./health` endpoint for service health checks.

```bash
[GET] https://{host}/health
```

## Application Load Balancer (ALB)

Service can be used in a **service-path** route forwarding, example endpoints:

```bash
https://services.some.app/giger/health
https://services.some.app/giger/upload/:profile/:object
https://services.some.app/giger/upload/:profile/:object/:tag
```

## Test

Upload a file using Curl

```bash
curl -F 'file=@sample/lena.jpg' http://g-giger.localhost/upload/default/avatar

curl -F 'file=@sample/some-video.mp4;type=video/mp4' http://g-giger.localhost/upload/default/video
```
