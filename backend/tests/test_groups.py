from app.uk_groups import load_groups, pack_batches


def test_default_config():
    groups = load_groups()
    enabled = [g for g in groups if g.enabled]
    assert len(enabled) == 4
    assert {g.id for g in enabled} == {"IST_ALL", "IST", "SAW", "ESB"}
    assert {g.id for g in groups if not g.enabled} == {"AYT", "ADB", "BJV", "DLM", "TZX", "ADA"}
    # Ankara (ESB) and both Istanbul airports (IST, SAW) are enabled
    all_enabled_airports = {a for g in enabled for a in g.airports}
    assert {"ESB", "IST", "SAW"}.issubset(all_enabled_airports)


def test_default_groups_pack_into_batches():
    enabled = [g for g in load_groups() if g.enabled]
    batches = pack_batches(enabled, 7)
    assert len(batches) == 1
    for b in batches:
        assert sum(len(g.airports) for g in b) <= 7
    # Istanbul (All) is never split
    assert sum(1 for b in batches for g in b if g.id == "IST_ALL") == 1


def test_more_groups_need_multiple_batches_at_small_size():
    groups = load_groups()  # all 10 groups, 11 airports
    batches = pack_batches(groups, 3)
    assert all(sum(len(g.airports) for g in b) <= 3 for b in batches)
    assert sorted(g.id for b in batches for g in b) == sorted(g.id for g in groups)
    assert len(batches) >= 4


def test_oversized_group_gets_its_own_batch():
    groups = [g for g in load_groups() if g.id in {"IST_ALL", "ESB"}]
    batches = pack_batches(groups, 2)
    assert [[g.id for g in b] for b in batches] == [["IST_ALL"], ["ESB"]]
