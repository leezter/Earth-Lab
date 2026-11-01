"""Reject unsupported source interpretations before publishing playable tiles."""


def validate_parking(scene):
    # This acceptance check is separate from the frozen renderer. Ground-level
    # parking footprints must not be accepted from an indoor/underground kind,
    # even when the source omits its location/level tags.
    for record in scene['parking_report']['records']:
        tags=record.get('source_tags',{})
        if (tags.get('parking') in {'underground','multi-storey','rooftop','garage_boxes','sheds'}
                or tags.get('building') not in {None,'','no'}):
            raise ValueError('Unsupported enclosed or layered parking footprint '+record['id']+
                             '. This renderer cannot safely publish this area.')
