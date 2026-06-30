package platform

import (
	"context"
	"io"
	"log/slog"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type ObjectStore struct {
	client *minio.Client
	bucket string
}

func NewObjectStore(endpoint, accessKey, secretKey, bucket string) (*ObjectStore, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: false,
	})
	if err != nil {
		return nil, err
	}

	ctx := context.Background()
	exists, err := client.BucketExists(ctx, bucket)
	if err != nil {
		return nil, err
	}
	if !exists {
		if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
			return nil, err
		}
		slog.Info("minio bucket created", "bucket", bucket)
	}

	return &ObjectStore{client: client, bucket: bucket}, nil
}

func (s *ObjectStore) PutThumbnail(ctx context.Context, key string, r io.Reader, size int64) error {
	_, err := s.client.PutObject(ctx, s.bucket, "thumbnails/"+key, r, size,
		minio.PutObjectOptions{ContentType: "image/jpeg"})
	return err
}
