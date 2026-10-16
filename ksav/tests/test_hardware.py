"""The recommendation must land somewhere workable on every machine.

The rule that matters most: a computer with no NVIDIA card must still get a
usable configuration. CPU only operation is a requirement, not a failure state.
"""

from __future__ import annotations

from app.platform.hardware import Gpu, Hardware, detect, recommend


def machine(ram=16.0, cores=8, gpus=()) -> Hardware:
    hw = Hardware(cpu_name="Test CPU", physical_cores=cores, logical_cores=cores * 2, ram_gb=ram)
    hw.gpus = list(gpus)
    hw.cuda_available = any(g.vendor == "nvidia" for g in hw.gpus)
    return hw


def test_detect_never_raises_and_always_answers():
    hw = detect()
    assert hw.cpu_name
    assert hw.logical_cores >= 1
    assert recommend(hw).asr_model


def test_a_big_nvidia_card_gets_the_largest_model():
    rec = recommend(machine(ram=64, gpus=[Gpu("RTX 4090", "nvidia", 24 * 1024)]))
    assert rec.asr_model == "whisper-large-v3"
    assert rec.device == "cuda"
    assert rec.diarization is True


def test_a_small_nvidia_card_gets_turbo_rather_than_large():
    rec = recommend(machine(gpus=[Gpu("RTX 2060", "nvidia", 6 * 1024)]))
    assert rec.asr_model == "whisper-large-v3-turbo"
    assert rec.device == "cuda"


def test_no_gpu_is_usable_not_broken():
    rec = recommend(machine(ram=16, cores=8))
    assert rec.device == "cpu"
    assert rec.compute_type == "int8"
    assert rec.asr_model, "a CPU only machine must still get a model"


def test_a_weak_machine_gets_the_small_model():
    rec = recommend(machine(ram=8, cores=4))
    assert rec.asr_model == "whisper-small"
    assert rec.device == "cpu"


def test_a_non_nvidia_gpu_uses_the_whisper_cpp_engine():
    rec = recommend(machine(gpus=[Gpu("Radeon RX 6700", "amd", 12 * 1024)]))
    assert rec.asr_engine == "whisper_cpp", "CTranslate2 has no path to an AMD card"


def test_every_recommendation_explains_itself():
    for gpus in ([], [Gpu("RTX 4090", "nvidia", 24576)], [Gpu("Arc A770", "intel", 16384)]):
        rec = recommend(machine(gpus=gpus))
        assert rec.reason and rec.speed_note, "a mystery default is not a default"


def test_summary_reads_as_a_sentence():
    hw = machine(gpus=[Gpu("RTX 3060", "nvidia", 12 * 1024)])
    assert "RTX 3060" in hw.summary()
    assert "12 GB" in hw.summary()
    assert "no dedicated GPU" in machine().summary()
