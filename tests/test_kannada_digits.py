"""Model-independent tests for spoken numeric capture and validation."""

from backend.forms.date_kn import extract_date_from_kannada
from backend.forms.kannada_digits import extract_digits_from_kannada
from backend.forms.validation import validate_captured_value
from backend.forms.stt_tuning import plausible_digit_capture


def test_extracts_native_and_spoken_digits() -> None:
    assert extract_digits_from_kannada("೧೨೩೪೫೬೭೮೯೦") == "1234567890"
    assert (
        extract_digits_from_kannada(
            "ಒಂದು ಎರಡು ಮೂರು ನಾಲ್ಕು ಐದು ಆರು ಏಳು ಎಂಟು ಒಂಬತ್ತು ಸೊನ್ನೆ"
        )
        == "1234567890"
    )


def test_extracts_spoken_number_groups() -> None:
    assert extract_digits_from_kannada("ಹನ್ನೆರಡು ಮೂವತ್ತನಾಲ್ಕು") == "1234"
    assert extract_digits_from_kannada("twenty five ten") == "2510"


def test_mobile_and_account_validation() -> None:
    assert (
        validate_captured_value(
            "9876543210",
            field_type="digits",
            field_id="mobile_number",
        )
        is None
    )
    assert validate_captured_value(
        "98765",
        field_type="digits",
        field_id="mobile_number",
    )
    assert (
        validate_captured_value(
            "1234567890",
            field_type="digits",
            field_id="account_number",
        )
        is None
    )
    assert validate_captured_value(
        "12345678",
        field_type="digits",
        field_id="account_number",
    )
    assert validate_captured_value(
        "12345",
        field_type="digits",
        field_id="account_number",
    )
    # Last-4 shortcut: 4 digits are accepted and resolved via account lookup.
    assert (
        validate_captured_value(
            "1234",
            field_type="digits",
            field_id="account_number",
        )
        is None
    )


def test_cheque_leaf_choices_are_constrained() -> None:
    assert (
        validate_captured_value(
            "25",
            field_type="digits",
            field_id="number_of_leaves",
        )
        is None
    )
    assert validate_captured_value(
        "30",
        field_type="digits",
        field_id="number_of_leaves",
    )


def test_extracts_numeric_and_spoken_kannada_dates() -> None:
    assert extract_date_from_kannada("14 10 2003") == "14/10/2003"
    assert extract_date_from_kannada("ನಾನು ಹೇಳಿದ್ದು 14 10 2003") == "14/10/2003"
    assert (
        extract_date_from_kannada("ಹದಿನಾಲ್ಕು ಹತ್ತು ಎರಡು ಸಾವಿರ ಮೂರು")
        == "14/10/2003"
    )


def test_date_validation_rejects_garbage_and_impossible_dates() -> None:
    assert (
        validate_captured_value(
            "14/10/2003",
            field_type="date",
            field_id="date_of_birth",
        )
        is None
    )
    assert validate_captured_value(
        "British ten three thousand and eighteen",
        field_type="date",
        field_id="date_of_birth",
    )
    assert validate_captured_value(
        "31/02/2003",
        field_type="date",
        field_id="date_of_birth",
    )


def test_mobile_capture_requires_all_ten_digits() -> None:
    assert not plausible_digit_capture("11", "mobile_number")
    assert plausible_digit_capture("9741447767", "mobile_number")
    assert not plausible_digit_capture("123456789", "account_number")
    assert plausible_digit_capture("1234567890", "account_number")
