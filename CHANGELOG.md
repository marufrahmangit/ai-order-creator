# Changelog

All notable changes to AI Order Creator are documented in this file.

## 4.7

- Removed every repeated raw-message occurrence of an extracted name or phone number while building the address, so duplicate details repeated near a signature no longer survive as address junk.

## 4.6

- Added alternate Bengali spellings for Tangail, Rangamati, and Chuadanga to the district/state list, improving detection across common spelling variants.

## 4.5

- Stopped treating a bare `location` as an address-wrapper label, preventing data loss for compound labels such as “Location & Postal Code”.
- Phone parsing now accepts a space or dash between the second and third digits.

## 4.4

- Recognized `M#`, `Mob#`, `Cell#`, and `Ph#` phone-label shorthand.
- Normalized `P,O`/`P,S` and underscore separators, and added `district`, `dist`, and `state` as removable address labels.

## 4.3

- Recognized `Add`/`Add:` as address labels and `Num`/`Num:` as phone labels.
- Added Babu Bazar to the Dhaka locality list.

## 4.2

- Recognized `Cell`, `Cell No`, and `Cell Number` phone labels.
- Removed common Bangla address/phone filler from addresses, added Mohammadia to the Dhaka locality list, and fixed `+880` phone parsing when separated by a space.

## 4.1

- Removed price detection from the deterministic parser and AI flow. Price is not supplied in the input, and its heuristics were misreading hyphen-attached house or plot numbers as prices and corrupting addresses.

## 4.0

- Prevented leftover labels from leaking into addresses, avoided treating numbered-list markers as field values, and made multi-line address labels capture their continuation lines.

## 3.9

- Split the single-file plugin into a multi-file structure (mechanical refactor; no logic changes).
