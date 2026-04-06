package utils

import (
	"crypto/rand"
	"math/big"
)

func Random4DigitString() (string, error) {
	const digits = "0123456789"
	out := make([]byte, 4)
	for i := range out {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		if err != nil {
			return "", err
		}
		out[i] = digits[n.Int64()]
	}
	return string(out), nil
}
