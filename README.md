Giger
=====

Container service for image resize/compression with AWS S3 uploader.
The service uses a MongoDB collection to read AWS and images configuration.

- Resize images in multiple thumbs.
- Validates image dimensions / aspect-ratio.
- Supports large files with async upload.
- Built on NodeJs.

## Images supported formats

- JPEG [mozjpeg](https://github.com/mozilla/mozjpeg)
- PNG [pngquant](https://github.com/kornelski/pngquant)
- Webp [webp](https://developers.google.com/speed/webp/docs/compression)

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
        "basePath": "giger/", // optional, must end with '/'
        "region": "us-east-1" // default is "us-east-1"
    },
    "objects": {

        "avatar": {

            "bucketPath": "avatars",     // optional, must end with '/'
            "maxAge": 86400,             // optional, default is 1 year
            "acl": "public-read",        // optional, default 'public-read'
            "async": false,              // optional, S3 async upload for big files, will save later the output URLs in another collection 'gigerAsyncUploads'
            "mimeTypes": ["image/jpeg"], // required, accepted mime-types ['image/jpeg','image/png', 'image/webp']
            "outputFormat": "webp",      // optional, default is same format as input image; for a different format requires at least one transform
            "constraints": {

                "minWidth": 300,  // optional
                "minHeight": 300, // optional
                "ratio": "3/2"    // aspect-ratio constraint, optional
            },
            "transforms": [

                {
                    "name": "L",  // the thumb version name
                    "width": 300, // resize width to 180px, height is auto-calculated keeping aspect-ratio
                    "quality": 90 // quality 1-100, for PNG files must be an array threshold [.3, .6], see pngquant docs
                },
                {
                    "name": "M",
                    "width": 150,
                    "quality": 90
                },
                {
                    "name": "S",
                    "width": 100,
                    "quality": 90
                },
                {
                    "name": "B",
                    "width": 100,
                    "quality": 21,
                    "blur": 8      // blur image (pixels)
                }
            ]
        },
        // supports big files uploads
        "video": {

            "bucketPath": "videos/",
            "maxAge": 86400,
            "async": true,
            "mimeTypes": ["video/mp4"]
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

### **./upload**

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

### **./health**

Service also includes a `[GET] /health` endpoint for service health checks.

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
```
curl -F 'file=@sample/lena.jpg' http://g-giger.localhost/upload/default/avatar

curl -F 'file=@sample/some-video.mp4;type=video/mp4' http://g-giger.localhost/upload/default/video
```
