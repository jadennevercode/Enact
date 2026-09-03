package skillbundle

import "testing"

func TestContentHashIgnoresFileOrder(t *testing.T) {
	a := ContentHash("n", "d", "c", []File{{Path: "b.md", Content: "B"}, {Path: "a.md", Content: "A"}})
	b := ContentHash("n", "d", "c", []File{{Path: "a.md", Content: "A"}, {Path: "b.md", Content: "B"}})
	if a != b {
		t.Fatalf("file order changed the hash: %s vs %s", a, b)
	}
}

func TestContentHashSeparatesAdjacentFields(t *testing.T) {
	// Without length framing "ab"+"c" and "a"+"bc" would digest identically,
	// and a rename that moved a character from the name into the description
	// would look like no change at all.
	if ContentHash("ab", "c", "", nil) == ContentHash("a", "bc", "", nil) {
		t.Fatal("adjacent fields ran together in the digest")
	}
}

func TestContentHashDistinguishesFilePathFromContent(t *testing.T) {
	if ContentHash("n", "d", "c", []File{{Path: "x", Content: "y"}}) ==
		ContentHash("n", "d", "c", []File{{Path: "xy", Content: ""}}) {
		t.Fatal("file path and content ran together in the digest")
	}
}

func TestContentHashIgnoresIdentity(t *testing.T) {
	// The whole reason this exists next to BuildManifest: same text, different
	// skill, same answer. BuildManifest deliberately differs here.
	same := ContentHash("n", "d", "c", nil)
	if same != ContentHash("n", "d", "c", nil) {
		t.Fatal("hash is not stable across calls")
	}
	if BuildManifest(Skill{ID: "1", Name: "n", Description: "d", Content: "c"}).Hash ==
		BuildManifest(Skill{ID: "2", Name: "n", Description: "d", Content: "c"}).Hash {
		t.Fatal("BuildManifest stopped folding identity in; ContentHash is now redundant")
	}
}

func TestContentHashChangesWithEveryField(t *testing.T) {
	base := ContentHash("n", "d", "c", []File{{Path: "p", Content: "v"}})
	for _, other := range []string{
		ContentHash("N", "d", "c", []File{{Path: "p", Content: "v"}}),
		ContentHash("n", "D", "c", []File{{Path: "p", Content: "v"}}),
		ContentHash("n", "d", "C", []File{{Path: "p", Content: "v"}}),
		ContentHash("n", "d", "c", []File{{Path: "P", Content: "v"}}),
		ContentHash("n", "d", "c", []File{{Path: "p", Content: "V"}}),
		ContentHash("n", "d", "c", nil),
	} {
		if base == other {
			t.Fatalf("a field change did not move the hash: %s", other)
		}
	}
}
