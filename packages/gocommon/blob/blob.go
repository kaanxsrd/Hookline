// Package blob stores large request bodies in S3-compatible object storage
// (MinIO locally, Cloudflare R2 or S3 in production).
package blob

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/google/uuid"
)

// ErrNotFound is returned by Get for a missing object.
var ErrNotFound = errors.New("blob: object not found")

// Store is the subset of object storage Hookline needs.
type Store interface {
	Put(ctx context.Context, key string, body []byte, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, keys ...string) error
	// List returns up to max objects whose keys sort after `after`, in key order.
	List(ctx context.Context, after string, max int) ([]Object, error)
	Ping(ctx context.Context) error
}

// Object is a stored object's key and age.
type Object struct {
	Key          string
	LastModified time.Time
}

// Key is the object key of a request body:
// <org or "anonymous">/<endpoint>/yyyy/mm/dd/<request>.
func Key(orgID *uuid.UUID, endpointID, requestID uuid.UUID, receivedAt time.Time) string {
	owner := "anonymous"
	if orgID != nil {
		owner = orgID.String()
	}
	return fmt.Sprintf("%s/%s/%s/%s", owner, endpointID, receivedAt.UTC().Format("2006/01/02"), requestID)
}

// S3Config configures an S3-compatible store.
type S3Config struct {
	Endpoint        string // empty for AWS S3
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	ForcePathStyle  bool // required by MinIO
}

// S3 implements Store on any S3-compatible service.
type S3 struct {
	client *s3.Client
	bucket string
}

// NewS3 returns a Store. It does not contact the service.
func NewS3(cfg S3Config) *S3 {
	client := s3.New(s3.Options{
		Region:       cfg.Region,
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		BaseEndpoint: nilIfEmpty(cfg.Endpoint),
		UsePathStyle: cfg.ForcePathStyle,
		// Bodies are uploaded from memory with a known length; skip the
		// optional checksum trailers some S3-compatible services reject.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})
	return &S3{client: client, bucket: cfg.Bucket}
}

// Put uploads body under key. Objects are private; there is no public URL.
func (s *S3) Put(ctx context.Context, key string, body []byte, contentType string) error {
	in := &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(body),
		ContentLength: aws.Int64(int64(len(body))),
	}
	if contentType != "" {
		in.ContentType = aws.String(contentType)
	}
	if _, err := s.client.PutObject(ctx, in); err != nil {
		return fmt.Errorf("blob put %s: %w", key, err)
	}
	return nil
}

// Get opens the object at key. The caller closes the reader.
func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		var nsk *types.NoSuchKey
		if errors.As(err, &nsk) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("blob get %s: %w", key, err)
	}
	return out.Body, nil
}

// Delete removes keys in batches of 1,000 (the S3 limit). Missing keys are not errors.
func (s *S3) Delete(ctx context.Context, keys ...string) error {
	for start := 0; start < len(keys); start += 1000 {
		batch := keys[start:min(start+1000, len(keys))]
		objects := make([]types.ObjectIdentifier, len(batch))
		for i, k := range batch {
			objects[i] = types.ObjectIdentifier{Key: aws.String(k)}
		}
		out, err := s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.bucket),
			Delete: &types.Delete{Objects: objects, Quiet: aws.Bool(true)},
		})
		if err != nil {
			return fmt.Errorf("blob delete: %w", err)
		}
		if len(out.Errors) > 0 {
			e := out.Errors[0]
			return fmt.Errorf("blob delete %s: %s", aws.ToString(e.Key), aws.ToString(e.Message))
		}
	}
	return nil
}

// List returns up to max objects after the given key.
func (s *S3) List(ctx context.Context, after string, max int) ([]Object, error) {
	in := &s3.ListObjectsV2Input{Bucket: aws.String(s.bucket), MaxKeys: aws.Int32(int32(min(max, 1000)))} //nolint:gosec // bounded by min
	if after != "" {
		in.StartAfter = aws.String(after)
	}
	out, err := s.client.ListObjectsV2(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("blob list: %w", err)
	}
	objects := make([]Object, 0, len(out.Contents))
	for _, o := range out.Contents {
		objects = append(objects, Object{Key: aws.ToString(o.Key), LastModified: aws.ToTime(o.LastModified)})
	}
	return objects, nil
}

// EnsureBucket creates the bucket when it does not exist yet. Self-hosted
// setups call it at boot; managed buckets (R2, S3) usually already exist.
func (s *S3) EnsureBucket(ctx context.Context) error {
	if s.Ping(ctx) == nil {
		return nil
	}
	_, err := s.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(s.bucket)})
	var owned *types.BucketAlreadyOwnedByYou
	if err != nil && !errors.As(err, &owned) {
		return fmt.Errorf("blob create bucket %s: %w", s.bucket, err)
	}
	return nil
}

// Ping checks that the bucket is reachable with the configured credentials.
func (s *S3) Ping(ctx context.Context) error {
	if _, err := s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)}); err != nil {
		return fmt.Errorf("blob ping: %w", err)
	}
	return nil
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
