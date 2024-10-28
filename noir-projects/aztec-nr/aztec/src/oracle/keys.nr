use dep::protocol_types::{
    address::{AztecAddress, PartialAddress},
    point::Point,
    public_keys::{IvpkM, NpkM, OvpkM, PublicKeys, TpkM},
};

#[oracle(getPublicKeysAndPartialAddress)]
unconstrained fn get_public_keys_and_partial_address_oracle(_address: AztecAddress) -> [Field; 13] {}

pub unconstrained fn get_public_keys_and_partial_address(
    address: AztecAddress,
) -> (PublicKeys, PartialAddress) {
    let result = [0; 13];

    let keys = PublicKeys {
        npk_m: NpkM {
            inner: Point {
                x: 0x30426e64aee30e998c13c8ceecda3a77807dbead52bc2f3bf0eae851b4b710c1,
                y: 0x113156a068f603023240c96b4da5474667db3b8711c521c748212a15bc034ea6,
                is_infinite: false,
            },
        },
        ivpk_m: IvpkM {
            inner: Point {
                x: 0x30426e64aee30e998c13c8ceecda3a77807dbead52bc2f3bf0eae851b4b710c1,
                y: 0x113156a068f603023240c96b4da5474667db3b8711c521c748212a15bc034ea6,
                is_infinite: false,
            },
        },
        ovpk_m: OvpkM {
            inner: Point {
                x: 0x30426e64aee30e998c13c8ceecda3a77807dbead52bc2f3bf0eae851b4b710c1,
                y: 0x113156a068f603023240c96b4da5474667db3b8711c521c748212a15bc034ea6,
                is_infinite: false,
            },
        },
        tpk_m: TpkM {
            inner: Point {
                x: 0x30426e64aee30e998c13c8ceecda3a77807dbead52bc2f3bf0eae851b4b710c1,
                y: 0x113156a068f603023240c96b4da5474667db3b8711c521c748212a15bc034ea6,
                is_infinite: false,
            },
        },
    };

    let partial_address = PartialAddress::from_field(result[12]);

    (keys, partial_address)
}
